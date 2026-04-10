#!/usr/bin/env python3
"""
╔══════════════════════════════════════════════════════╗
║  OMRON HEM-7143T1-A — Bluetooth Bridge               ║
║  Samarthaa Hospital · ICU Ward 6A                    ║
║                                                      ║
║  Reads BP + HR from Omron via Bluetooth              ║
║  Sends live data to VitalWatch dashboard             ║
║                                                      ║
║  Run this on the bedside laptop:                     ║
║    python3 omron_bridge.py                           ║
╚══════════════════════════════════════════════════════╝
"""

import asyncio
import json
import time
import requests
import logging
import sys
import os
from datetime import datetime
from bleak import BleakScanner, BleakClient

# ══════════════════════════════════════════
#  CONFIGURATION — Edit these values
# ══════════════════════════════════════════

# Your VitalWatch server URL on Render
VITALWATCH_URL = "https://virtual-icu.onrender.com"

# Patient this device is assigned to (must match patient ID in data.js)
PATIENT_ID     = "P001"
PATIENT_NAME   = "Ramesh Kumar"
BED_NUMBER     = "Bed 01"

# Auto-reading interval in minutes
AUTO_INTERVAL_MINUTES = 15

# Omron device name (as it appears in Bluetooth scan)
OMRON_DEVICE_NAME = "BLEsmart_"   # Omron devices start with this

# API key for your VitalWatch server (set in Render env vars)
VITALWATCH_API_KEY = os.environ.get("VITALWATCH_API_KEY", "samarthaa-icu-2024")

# ══════════════════════════════════════════
#  OMRON BLUETOOTH GATT UUIDs
#  (Standard Bluetooth Health Device Profile)
# ══════════════════════════════════════════

# Blood Pressure Service
BP_SERVICE_UUID         = "00001810-0000-1000-8000-00805f9b34fb"
BP_MEASUREMENT_UUID     = "00002a35-0000-1000-8000-00805f9b34fb"
INTERMEDIATE_BP_UUID    = "00002a36-0000-1000-8000-00805f9b34fb"

# Device Information
DEVICE_INFO_UUID        = "0000180a-0000-1000-8000-00805f9b34fb"
MANUFACTURER_UUID       = "00002a29-0000-1000-8000-00805f9b34fb"

# Current Time (needed to sync with Omron)
CURRENT_TIME_SERVICE    = "00001805-0000-1000-8000-00805f9b34fb"
CURRENT_TIME_UUID       = "00002a2b-0000-1000-8000-00805f9b34fb"

# ══════════════════════════════════════════
#  LOGGING
# ══════════════════════════════════════════
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    datefmt='%H:%M:%S',
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler('omron_bridge.log')
    ]
)
log = logging.getLogger(__name__)

# ══════════════════════════════════════════
#  PARSE OMRON BP DATA
#  Bluetooth BP measurement format (IEEE 11073)
# ══════════════════════════════════════════
def parse_bp_measurement(data: bytearray) -> dict:
    """Parse raw Bluetooth BP measurement bytes from Omron."""
    try:
        flags = data[0]
        unit_mmhg = not (flags & 0x01)  # bit 0: 0=mmHg, 1=kPa
        has_timestamp = bool(flags & 0x02)
        has_pulse_rate = bool(flags & 0x04)

        # Bytes 1-6: systolic, diastolic, MAP (IEEE 11073 SFLOAT format)
        def sfloat(b1, b2):
            """Decode IEEE 11073 SFLOAT (2 bytes)."""
            val = (b2 << 8) | b1
            mantissa = val & 0x0FFF
            if mantissa >= 0x0800:
                mantissa -= 0x1000
            exponent = (val >> 12) & 0x0F
            if exponent >= 0x08:
                exponent -= 0x10
            return round(mantissa * (10 ** exponent), 1)

        systolic  = sfloat(data[1], data[2])
        diastolic = sfloat(data[3], data[4])
        mean_ap   = sfloat(data[5], data[6])

        result = {
            "systolic":  systolic,
            "diastolic": diastolic,
            "mean_ap":   mean_ap,
            "unit":      "mmHg" if unit_mmhg else "kPa",
            "timestamp": datetime.now().isoformat(),
        }

        offset = 7

        # Optional timestamp (7 bytes)
        if has_timestamp and len(data) > offset + 6:
            year   = (data[offset+1] << 8) | data[offset]
            month  = data[offset+2]
            day    = data[offset+3]
            hour   = data[offset+4]
            minute = data[offset+5]
            second = data[offset+6]
            result["device_timestamp"] = f"{year}-{month:02d}-{day:02d} {hour:02d}:{minute:02d}:{second:02d}"
            offset += 7

        # Optional pulse rate
        if has_pulse_rate and len(data) > offset + 1:
            result["pulse_rate"] = int(sfloat(data[offset], data[offset+1]))

        return result

    except Exception as e:
        log.error(f"Failed to parse BP data: {e} | Raw: {data.hex()}")
        return None


# ══════════════════════════════════════════
#  SEND TO VITALWATCH
# ══════════════════════════════════════════
def send_to_vitalwatch(reading: dict):
    """Push a BP reading to the VitalWatch server."""
    try:
        payload = {
            "patient_id":   PATIENT_ID,
            "patient_name": PATIENT_NAME,
            "bed":          BED_NUMBER,
            "source":       "omron_hem7143",
            "vitals": {
                "bps":  reading.get("systolic"),
                "bpd":  reading.get("diastolic"),
                "hr":   reading.get("pulse_rate"),
                "map":  reading.get("mean_ap"),
            },
            "unit":       reading.get("unit", "mmHg"),
            "timestamp":  reading.get("timestamp"),
            "api_key":    VITALWATCH_API_KEY
        }

        # Remove None values
        payload["vitals"] = {k: v for k, v in payload["vitals"].items() if v is not None}

        response = requests.post(
            f"{VITALWATCH_URL}/api/vitals",
            json=payload,
            timeout=10
        )

        if response.status_code == 200:
            log.info(f"✅ Sent to VitalWatch: {PATIENT_NAME} — "
                     f"BP {reading.get('systolic')}/{reading.get('diastolic')} mmHg, "
                     f"HR {reading.get('pulse_rate', 'N/A')} bpm")
        else:
            log.warning(f"⚠️  VitalWatch returned {response.status_code}: {response.text[:100]}")

    except requests.exceptions.ConnectionError:
        log.warning("⚠️  Cannot reach VitalWatch server — reading saved locally")
        save_locally(reading)
    except Exception as e:
        log.error(f"❌ Failed to send to VitalWatch: {e}")
        save_locally(reading)


def save_locally(reading: dict):
    """Save reading to local file if server unreachable."""
    fname = f"offline_readings_{datetime.now().strftime('%Y%m%d')}.json"
    try:
        existing = []
        if os.path.exists(fname):
            with open(fname) as f:
                existing = json.load(f)
        existing.append({**reading, "patient_id": PATIENT_ID, "bed": BED_NUMBER})
        with open(fname, 'w') as f:
            json.dump(existing, f, indent=2)
        log.info(f"💾 Saved offline: {fname}")
    except Exception as e:
        log.error(f"Could not save locally: {e}")


def sync_offline_readings():
    """Try to send any offline readings when connection restored."""
    import glob
    files = glob.glob("offline_readings_*.json")
    for fname in files:
        try:
            with open(fname) as f:
                readings = json.load(f)
            sent = 0
            for r in readings:
                try:
                    response = requests.post(
                        f"{VITALWATCH_URL}/api/vitals",
                        json={**r, "api_key": VITALWATCH_API_KEY},
                        timeout=5
                    )
                    if response.status_code == 200:
                        sent += 1
                except:
                    pass
            if sent == len(readings):
                os.remove(fname)
                log.info(f"✅ Synced {sent} offline readings from {fname}")
            else:
                log.info(f"⚠️  Synced {sent}/{len(readings)} offline readings")
        except Exception as e:
            log.error(f"Sync error: {e}")


# ══════════════════════════════════════════
#  BLUETOOTH SCANNER
# ══════════════════════════════════════════
async def find_omron_device():
    """Scan for Omron device in Bluetooth range."""
    log.info("🔍 Scanning for Omron device...")
    log.info("   → Press the START button on your Omron BP monitor now")

    devices = await BleakScanner.discover(timeout=15.0)

    for device in devices:
        name = device.name or ""
        log.info(f"   Found: {name} ({device.address})")
        if OMRON_DEVICE_NAME.lower() in name.lower() or "omron" in name.lower():
            log.info(f"✅ Found Omron device: {name} at {device.address}")
            return device

    log.warning("⚠️  No Omron device found. Make sure:")
    log.warning("   1. Bluetooth is ON on this laptop")
    log.warning("   2. Omron is in pairing/transfer mode (press START)")
    log.warning("   3. Omron is within 1 metre of this laptop")
    return None


# ══════════════════════════════════════════
#  TAKE A READING
# ══════════════════════════════════════════
async def take_reading(device_address: str = None) -> dict:
    """Connect to Omron, retrieve BP reading, disconnect."""
    received_reading = None

    if not device_address:
        device = await find_omron_device()
        if not device:
            return None
        device_address = device.address

    def on_bp_notification(sender, data):
        nonlocal received_reading
        log.info(f"📡 Received BP data ({len(data)} bytes)")
        reading = parse_bp_measurement(bytearray(data))
        if reading:
            received_reading = reading
            log.info(f"   Systolic:  {reading.get('systolic')} mmHg")
            log.info(f"   Diastolic: {reading.get('diastolic')} mmHg")
            log.info(f"   Pulse:     {reading.get('pulse_rate', 'N/A')} bpm")

    try:
        log.info(f"📶 Connecting to {device_address}...")
        async with BleakClient(device_address, timeout=20.0) as client:
            log.info("✅ Connected to Omron")

            # Sync time so Omron timestamps readings correctly
            try:
                now = datetime.now()
                time_data = bytearray([
                    now.year & 0xFF, (now.year >> 8) & 0xFF,
                    now.month, now.day, now.hour, now.minute, now.second,
                    now.weekday() + 1, 0, 0
                ])
                await client.write_gatt_char(CURRENT_TIME_UUID, time_data)
                log.info("⏰ Time synced with Omron")
            except Exception:
                pass  # Time sync is optional

            # Subscribe to BP measurement notifications
            await client.start_notify(BP_MEASUREMENT_UUID, on_bp_notification)
            log.info("👂 Listening for BP measurement...")
            log.info("   → Press START on the Omron monitor to take a reading")

            # Wait up to 90 seconds for a reading
            for _ in range(90):
                if received_reading:
                    break
                await asyncio.sleep(1)

            await client.stop_notify(BP_MEASUREMENT_UUID)

    except Exception as e:
        log.error(f"❌ Bluetooth error: {e}")
        return None

    if received_reading:
        send_to_vitalwatch(received_reading)
    else:
        log.warning("⚠️  No reading received within timeout")

    return received_reading


# ══════════════════════════════════════════
#  AUTO-READING LOOP
# ══════════════════════════════════════════
async def auto_reading_loop():
    """Take automatic readings at regular intervals."""
    log.info(f"⏱️  Auto-reading every {AUTO_INTERVAL_MINUTES} minutes")
    log.info("   Press Ctrl+C to stop")

    while True:
        log.info(f"\n{'='*50}")
        log.info(f"🩺 Auto reading — {datetime.now().strftime('%d %b %Y %H:%M')}")
        log.info(f"   Patient: {PATIENT_NAME} · {BED_NUMBER}")
        log.info(f"{'='*50}")

        await take_reading()
        sync_offline_readings()

        log.info(f"\n⏳ Next reading in {AUTO_INTERVAL_MINUTES} minutes...")
        await asyncio.sleep(AUTO_INTERVAL_MINUTES * 60)


# ══════════════════════════════════════════
#  MANUAL READING (single shot)
# ══════════════════════════════════════════
async def manual_reading():
    """Take a single manual reading."""
    print(f"\n{'='*50}")
    print(f"🩺 MANUAL READING")
    print(f"   Patient: {PATIENT_NAME} · {BED_NUMBER}")
    print(f"   Time:    {datetime.now().strftime('%d %b %Y %H:%M:%S')}")
    print(f"{'='*50}\n")
    print("Press START on the Omron monitor when ready...\n")
    result = await take_reading()
    if result:
        print(f"\n✅ Reading complete:")
        print(f"   BP:    {result.get('systolic')}/{result.get('diastolic')} mmHg")
        print(f"   Pulse: {result.get('pulse_rate', 'N/A')} bpm")
    else:
        print("\n❌ Reading failed — try again")
    return result


# ══════════════════════════════════════════
#  MAIN
# ══════════════════════════════════════════
async def main():
    print("""
╔══════════════════════════════════════════════════════╗
║          OMRON Bridge — Samarthaa Hospital           ║
║          ICU Ward 6A · VitalWatch v2.4               ║
╚══════════════════════════════════════════════════════╝
""")
    print(f"  Patient:  {PATIENT_NAME} ({BED_NUMBER})")
    print(f"  Server:   {VITALWATCH_URL}")
    print(f"  Auto:     Every {AUTO_INTERVAL_MINUTES} minutes")
    print()

    if len(sys.argv) > 1 and sys.argv[1] == "--manual":
        # Manual mode: single reading
        await manual_reading()
    elif len(sys.argv) > 1 and sys.argv[1] == "--scan":
        # Just scan for devices
        devices = await BleakScanner.discover(timeout=10.0)
        print("\nNearby Bluetooth devices:")
        for d in devices:
            print(f"  {d.name or 'Unknown':30s}  {d.address}")
    else:
        # Default: auto loop
        await auto_reading_loop()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n\n👋 Bridge stopped. Goodbye.")
