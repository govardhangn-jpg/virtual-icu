#!/usr/bin/env python3
"""
Omron HEM-7143T1-A Bluetooth Bridge
Samarthaa Hospital - ICU Ward 6A
Compatible: Python 3.8+ / bleak 3.x

Usage:
  python omron_bridge.py          # Auto mode every 15 min
  python omron_bridge.py --once   # Single reading
  python omron_bridge.py --manual # Manual menu
  python omron_bridge.py --scan   # Scan devices
"""

import asyncio
import json
import sys
import os
import logging
from datetime import datetime

# ── CONFIG ──────────────────────────────────────────
VITALWATCH_URL        = "https://virtual-icu.onrender.com"
PATIENT_ID            = "P001"
PATIENT_NAME          = "Ramesh Kumar"
BED_NUMBER            = "Bed 01"
AUTO_INTERVAL_MINUTES = 15
VITALWATCH_API_KEY    = os.environ.get("VITALWATCH_API_KEY", "samarthaa-icu-2024")
OMRON_MAC             = "FF:DF:7B:0D:14:9E"
OMRON_NAME            = "BLESmart_0000049CFFDF7B0D149E"

# ── GATT UUIDs ──────────────────────────────────────
BP_MEASUREMENT_UUID = "00002a35-0000-1000-8000-00805f9b34fb"
CURRENT_TIME_UUID   = "00002a2b-0000-1000-8000-00805f9b34fb"

# ── LOGGING ─────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s  %(message)s',
    datefmt='%H:%M:%S',
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler('omron_bridge.log', encoding='utf-8')
    ]
)
log = logging.getLogger(__name__)

# ── IMPORTS ─────────────────────────────────────────
try:
    from bleak import BleakScanner, BleakClient
    try:
        import importlib.metadata
        bv = importlib.metadata.version('bleak')
    except Exception:
        bv = '3.x'
    log.info(f"bleak {bv} loaded")
except ImportError:
    print("\nERROR: bleak not installed. Run:  pip install bleak requests")
    sys.exit(1)

try:
    import requests
except ImportError:
    print("\nERROR: requests not installed. Run:  pip install bleak requests")
    sys.exit(1)


# ── PARSE BP DATA ────────────────────────────────────
def parse_bp(data):
    try:
        flags         = data[0]
        has_timestamp = bool(flags & 0x02)
        has_pulse     = bool(flags & 0x04)

        def sfloat(lo, hi):
            raw      = (hi << 8) | lo
            mantissa = raw & 0x0FFF
            exponent = (raw >> 12) & 0x0F
            if mantissa >= 0x0800:
                mantissa -= 0x1000
            if exponent >= 0x08:
                exponent -= 0x10
            return round(mantissa * (10 ** exponent), 1)

        systolic  = sfloat(data[1], data[2])
        diastolic = sfloat(data[3], data[4])

        result = {
            "systolic":  systolic,
            "diastolic": diastolic,
            "timestamp": datetime.now().isoformat(),
        }

        offset = 7
        if has_timestamp and len(data) >= offset + 7:
            y = (data[offset + 1] << 8) | data[offset]
            result["device_time"] = (
                f"{y}-{data[offset+2]:02d}-{data[offset+3]:02d} "
                f"{data[offset+4]:02d}:{data[offset+5]:02d}"
            )
            offset += 7

        if has_pulse and len(data) >= offset + 2:
            result["pulse_rate"] = int(sfloat(data[offset], data[offset + 1]))

        return result

    except Exception as e:
        log.error(f"Parse error: {e} | raw: {bytearray(data).hex()}")
        return None


# ── SEND TO VITALWATCH ───────────────────────────────
def push_reading(reading):
    payload = {
        "patient_id":   PATIENT_ID,
        "patient_name": PATIENT_NAME,
        "bed":          BED_NUMBER,
        "source":       "omron_hem7143",
        "vitals": {
            "bps": reading.get("systolic"),
            "bpd": reading.get("diastolic"),
            "hr":  reading.get("pulse_rate"),
        },
        "timestamp": reading.get("timestamp"),
        "api_key":   VITALWATCH_API_KEY,
    }
    payload["vitals"] = {k: v for k, v in payload["vitals"].items() if v is not None}

    try:
        r = requests.post(f"{VITALWATCH_URL}/api/vitals", json=payload, timeout=10)
        if r.status_code == 200:
            log.info(
                f"Sent to VitalWatch: "
                f"BP {reading.get('systolic')}/{reading.get('diastolic')} mmHg  "
                f"HR {reading.get('pulse_rate', '--')} bpm"
            )
        else:
            log.warning(f"Server returned {r.status_code}")
            save_offline(reading)
    except requests.exceptions.ConnectionError:
        log.warning("No internet — saved offline")
        save_offline(reading)
    except Exception as e:
        log.error(f"Send error: {e}")
        save_offline(reading)


def save_offline(reading):
    fname = f"offline_{datetime.now().strftime('%Y%m%d')}.json"
    try:
        data = []
        if os.path.exists(fname):
            with open(fname) as f:
                data = json.load(f)
        data.append({**reading, "patient_id": PATIENT_ID, "bed": BED_NUMBER})
        with open(fname, 'w') as f:
            json.dump(data, f, indent=2)
        log.info(f"Offline save: {fname}")
    except Exception as e:
        log.error(f"Offline save failed: {e}")


def sync_offline():
    import glob
    for fname in glob.glob("offline_*.json"):
        try:
            with open(fname) as f:
                readings = json.load(f)
            sent = 0
            for r in readings:
                try:
                    resp = requests.post(
                        f"{VITALWATCH_URL}/api/vitals",
                        json={**r, "api_key": VITALWATCH_API_KEY},
                        timeout=5
                    )
                    if resp.status_code == 200:
                        sent += 1
                except Exception:
                    pass
            if sent == len(readings):
                os.remove(fname)
                log.info(f"Synced {sent} offline readings")
        except Exception:
            pass


# ── SCAN ────────────────────────────────────────────
async def scan_only():
    print("\nScanning Bluetooth devices (10 seconds)...\n")
    async with BleakScanner() as scanner:
        await asyncio.sleep(10)
        devices = scanner.discovered_devices

    print(f"Found {len(devices)} device(s):\n")
    print(f"  {'Name':40s}  {'Address'}")
    print(f"  {'-'*40}  {'-'*20}")
    for d in devices:
        name = d.name or "(no name)"
        print(f"  {name:40s}  {d.address}")
    print("\nOmron device name starts with: BLESmart_")


# ── TAKE ONE READING ─────────────────────────────────
async def take_reading(address=None):
    if not address:
        address = OMRON_MAC

    # Known Omron proprietary UUIDs (discovered from device)
    OMRON_DATA_UUID    = "b305b680-aee7-11e1-a730-0002a5d5c51b"
    OMRON_MEASURE_UUID = "49123040-aee8-11e1-a74d-0002a5d5c51b"

    # Guide user BEFORE they start — do everything at once
    print()
    print("  +--------------------------------------------------+")
    print("  |  DO ALL THESE STEPS QUICKLY (within 60 seconds) |")
    print("  |                                                  |")
    print("  |  1. Put cuff on arm NOW                         |")
    print("  |  2. Hold MEMORY button 3 sec -> Bluetooth ON    |")
    print("  |  3. Immediately press ENTER below               |")
    print("  |  4. Then press START on Omron to take reading   |")
    print("  +--------------------------------------------------+")
    print()
    input("  Press ENTER after Bluetooth symbol appears on Omron... ")
    print()

    received = None
    event    = asyncio.Event()
    raw_data = []

    def on_notify(sender, data):
        nonlocal received
        raw = bytearray(data)
        raw_data.append(raw.hex())
        log.info(f"  Data: {raw.hex()} ({len(raw)} bytes)")

        # Try standard parse first
        r = parse_bp(raw)
        if r and r.get('systolic') and r['systolic'] > 0:
            received = r
            log.info(f"  Systolic:  {r.get('systolic')} mmHg")
            log.info(f"  Diastolic: {r.get('diastolic')} mmHg")
            log.info(f"  Pulse:     {r.get('pulse_rate','--')} bpm")
            event.set()
        else:
            # Try Omron custom format
            r2 = parse_omron_custom(raw)
            if r2:
                received = r2
                log.info(f"  Systolic:  {r2.get('systolic')} mmHg")
                log.info(f"  Diastolic: {r2.get('diastolic')} mmHg")
                log.info(f"  Pulse:     {r2.get('pulse_rate','--')} bpm")
                event.set()
            else:
                log.info("  (data received but not a BP reading — waiting for more)")

    log.info(f"Connecting to {address} ...")

    try:
        async with BleakClient(address, timeout=20.0) as client:
            log.info("Connected! Subscribing to Omron channels...")

            # Subscribe to ALL notifiable characteristics simultaneously
            subscribed = []
            for service in client.services:
                for char in service.characteristics:
                    if "notify" in char.properties or "indicate" in char.properties:
                        try:
                            await client.start_notify(char.uuid, on_notify)
                            subscribed.append(char.uuid)
                            log.info(f"  Listening on: {char.uuid}")
                        except Exception as e:
                            log.info(f"  Skipped {char.uuid}: {e}")

            if not subscribed:
                log.error("Could not subscribe to any characteristic")
                return None

            # Sync time
            try:
                now = datetime.now()
                tb  = bytearray([
                    now.year & 0xFF, (now.year >> 8) & 0xFF,
                    now.month, now.day, now.hour, now.minute, now.second,
                    now.weekday() + 1, 0, 0
                ])
                await client.write_gatt_char(CURRENT_TIME_UUID, tb)
                log.info("Time synced")
            except Exception:
                pass

            print()
            print("  READY — Press START on Omron NOW to take reading...")
            print()

            # Wait up to 60 seconds for data
            try:
                await asyncio.wait_for(event.wait(), timeout=60.0)
            except asyncio.TimeoutError:
                log.warning("Timeout — no BP reading received in 60 seconds")
                if raw_data:
                    log.info(f"Raw data captured (for debugging): {raw_data}")

            # Unsubscribe
            for uuid in subscribed:
                try:
                    await client.stop_notify(uuid)
                except Exception:
                    pass

    except Exception as e:
        log.error(f"Bluetooth error: {e}")
        if "not found" in str(e).lower():
            log.error("Omron Bluetooth timed out — enable it again and retry immediately")
        return None

    if received:
        push_reading(received)
        sync_offline()
    else:
        log.warning("No reading received")
        if raw_data:
            log.info(f"Raw bytes captured: {raw_data}")
            log.info("Sending these to developer for custom parser update")

    return received


def parse_omron_custom(data):
    """Try to parse Omron custom format BP data."""
    try:
        if len(data) < 6:
            return None
        # Omron sometimes sends: [status, sys_hi, sys_lo, dia_hi, dia_lo, pulse]
        # or little-endian 2-byte values
        candidates = []

        # Try format: byte pairs as little-endian integers
        if len(data) >= 6:
            v1 = data[0] | (data[1] << 8)
            v2 = data[2] | (data[3] << 8)
            v3 = data[4] | (data[5] << 8)
            # Check if values look like BP (systolic 70-220, diastolic 40-130)
            if 70 <= v1 <= 220 and 40 <= v2 <= 130:
                candidates.append({'systolic': v1, 'diastolic': v2,
                                   'pulse_rate': v3 if 30 <= v3 <= 200 else None,
                                   'timestamp': datetime.now().isoformat()})

        # Try format: single bytes
        if len(data) >= 3:
            if 70 <= data[0] <= 220 and 40 <= data[1] <= 130:
                candidates.append({'systolic': data[0], 'diastolic': data[1],
                                   'pulse_rate': data[2] if 30 <= data[2] <= 200 else None,
                                   'timestamp': datetime.now().isoformat()})

        return candidates[0] if candidates else None

    except Exception:
        return None


# ── AUTO LOOP ────────────────────────────────────────
async def auto_loop():
    log.info(f"Auto mode — reading every {AUTO_INTERVAL_MINUTES} minutes")
    log.info("Press Ctrl+C to stop\n")
    while True:
        print(f"\n{'='*52}")
        print(f"  Patient: {PATIENT_NAME} | {BED_NUMBER}")
        print(f"  Time:    {datetime.now().strftime('%d %b %Y  %H:%M:%S')}")
        print(f"{'='*52}")
        await take_reading()
        log.info(f"Next reading in {AUTO_INTERVAL_MINUTES} minutes...")
        await asyncio.sleep(AUTO_INTERVAL_MINUTES * 60)


# ── MANUAL MENU ──────────────────────────────────────
async def manual_menu():
    print("\n=== MANUAL READING MENU ===\n")
    while True:
        print(f"Patient: {PATIENT_NAME} ({BED_NUMBER})")
        print("  1. Take reading")
        print("  2. Scan devices")
        print("  0. Exit")
        choice = input("\nEnter number: ").strip()
        if choice == "0":
            break
        elif choice == "2":
            await scan_only()
        elif choice == "1":
            result = await take_reading()
            if result:
                print(f"\n  BP:    {result.get('systolic')}/{result.get('diastolic')} mmHg")
                print(f"  Pulse: {result.get('pulse_rate', '--')} bpm")
                print("  Sent to VitalWatch dashboard\n")
            else:
                print("\n  No reading. Try again.\n")


# ── MAIN ─────────────────────────────────────────────
async def main():
    print("""
+==============================================+
|   Omron Bridge - Samarthaa Hospital         |
|   ICU Ward 6A  |  VitalWatch v2.4           |
+==============================================+
""")
    print(f"  Patient:  {PATIENT_NAME} ({BED_NUMBER})")
    print(f"  Server:   {VITALWATCH_URL}")
    print(f"  Device:   {OMRON_NAME}")
    print(f"  Address:  {OMRON_MAC}\n")

    args = sys.argv[1:]

    if "--scan" in args:
        await scan_only()
    elif "--manual" in args:
        await manual_menu()
    elif "--once" in args:
        await take_reading()
    else:
        await auto_loop()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\nBridge stopped.")
