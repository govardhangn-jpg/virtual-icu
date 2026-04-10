#!/usr/bin/env python3
"""
╔══════════════════════════════════════════════════════╗
║  OMRON HEM-7143T1-A — Bluetooth Bridge               ║
║  Samarthaa Hospital · ICU Ward 6A                    ║
║  Compatible: Python 3.8+ · bleak 3.x                ║
╚══════════════════════════════════════════════════════╝

Usage:
  python omron_bridge.py              # Auto mode (every 15 min)
  python omron_bridge.py --manual     # Manual menu
  python omron_bridge.py --scan       # Scan Bluetooth devices
  python omron_bridge.py --once       # Take one reading and exit
"""

import asyncio
import json
import time
import sys
import os
import logging
from datetime import datetime

# ══════════════════════════════════════════════
#  CONFIGURATION — Edit these
# ══════════════════════════════════════════════
VITALWATCH_URL         = "https://virtual-icu.onrender.com"
PATIENT_ID             = "P001"
PATIENT_NAME           = "Ramesh Kumar"
BED_NUMBER             = "Bed 01"
AUTO_INTERVAL_MINUTES  = 15
VITALWATCH_API_KEY     = os.environ.get("VITALWATCH_API_KEY", "samarthaa-icu-2024")

# Omron device — Samarthaa Hospital Ward 6A, Bed 01
OMRON_MAC              = "FF:DF:7B:0D:14:9E"   # BLESmart_0000049CFFDF7B0D149E
OMRON_NAME             = "BLESmart_0000049CFFDF7B0D149E" 

# ══════════════════════════════════════════════
#  LOGGING
# ══════════════════════════════════════════════
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

# ══════════════════════════════════════════════
#  CHECK DEPENDENCIES
# ══════════════════════════════════════════════
try:
    from bleak import BleakScanner, BleakClient
    try:
        import importlib.metadata
        bv = importlib.metadata.version('bleak')
    except Exception:
        bv = '3.x'
    log.info(f"✅ bleak {bv} loaded")
except ImportError:
    print("\n❌ bleak not installed. Run:")
    print("   pip install bleak requests")
    sys.exit(1)

try:
    import requests
except ImportError:
    print("\n❌ requests not installed. Run:")
    print("   pip install bleak requests")
    sys.exit(1)

# ══════════════════════════════════════════════
#  OMRON BLUETOOTH GATT UUIDs
#  Standard Bluetooth Health Device Profile (HDP)
# ══════════════════════════════════════════════
BP_SERVICE_UUID      = "00001810-0000-1000-8000-00805f9b34fb"
BP_MEASUREMENT_UUID  = "00002a35-0000-1000-8000-00805f9b34fb"
CURRENT_TIME_UUID    = "00002a2b-0000-1000-8000-00805f9b34fb"

# ══════════════════════════════════════════════
#  PARSE OMRON BP DATA
# ══════════════════════════════════════════════
def parse_bp(data: bytearray) -> dict:
    """Parse IEEE 11073 Blood Pressure Measurement characteristic."""
    try:
        flags         = data[0]
        has_timestamp = bool(flags & 0x02)
        has_pulse     = bool(flags & 0x04)

        def sfloat(lo, hi):
            """Decode 2-byte IEEE 11073 SFLOAT."""
            raw      = (hi << 8) | lo
            mantissa = raw & 0x0FFF
            exponent = (raw >> 12) & 0x0F
            if mantissa >= 0x0800: mantissa -= 0x1000
            if exponent >= 0x08:   exponent -= 0x10
            return round(mantissa * (10 ** exponent), 1)

        systolic  = sfloat(data[1], data[2])
        diastolic = sfloat(data[3], data[4])
        result    = {
            "systolic":  systolic,
            "diastolic": diastolic,
            "timestamp": datetime.now().isoformat(),
        }

        offset = 7
        if has_timestamp and len(data) >= offset + 7:
            y = (data[offset+1] << 8) | data[offset]
            result["device_time"] = f"{y}-{data[offset+2]:02d}-{data[offset+3]:02d} {data[offset+4]:02d}:{data[offset+5]:02d}"
            offset += 7

        if has_pulse and len(data) >= offset + 2:
            result["pulse_rate"] = int(sfloat(data[offset], data[offset+1]))

        return result

    except Exception as e:
        log.error(f"Parse error: {e} | raw: {data.hex()}")
        return None

# ══════════════════════════════════════════════
#  SEND TO VITALWATCH
# ══════════════════════════════════════════════
def push_reading(reading: dict):
    """Send BP reading to VitalWatch server."""
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
            log.info(f"✅ Sent → VitalWatch: BP {reading.get('systolic')}/{reading.get('diastolic')} mmHg  HR {reading.get('pulse_rate','--')} bpm")
        else:
            log.warning(f"⚠️  Server returned {r.status_code}")
            save_offline(reading)
    except requests.exceptions.ConnectionError:
        log.warning("⚠️  No internet — saved offline")
        save_offline(reading)
    except Exception as e:
        log.error(f"Send error: {e}")
        save_offline(reading)

def save_offline(reading: dict):
    fname = f"offline_{datetime.now().strftime('%Y%m%d')}.json"
    try:
        data = []
        if os.path.exists(fname):
            with open(fname) as f: data = json.load(f)
        data.append({**reading, "patient_id": PATIENT_ID, "bed": BED_NUMBER})
        with open(fname, 'w') as f: json.dump(data, f, indent=2)
        log.info(f"💾 Offline save: {fname}")
    except Exception as e:
        log.error(f"Offline save failed: {e}")

def sync_offline():
    import glob
    for fname in glob.glob("offline_*.json"):
        try:
            with open(fname) as f: readings = json.load(f)
            sent = 0
            for r in readings:
                try:
                    resp = requests.post(f"{VITALWATCH_URL}/api/vitals", json={**r,"api_key":VITALWATCH_API_KEY}, timeout=5)
                    if resp.status_code == 200: sent += 1
                except: pass
            if sent == len(readings):
                os.remove(fname)
                log.info(f"✅ Synced {sent} offline readings")
        except: pass

# ══════════════════════════════════════════════
#  SCAN FOR OMRON DEVICE
# ══════════════════════════════════════════════
async def find_omron():
    """Scan Bluetooth and return first Omron device found."""
    log.info("🔍 Scanning Bluetooth (15 seconds)...")
    log.info("   → Press START on the Omron monitor now")

    found = None
    # bleak 3.x uses async context manager for scanner
    async with BleakScanner() as scanner:
        await asyncio.sleep(15)
        devices = scanner.discovered_devices

    for d in devices:
        name = d.name or ""
        log.info(f"   {name:30s}  {d.address}")
        if any(x in name.lower() for x in ["blesmart", "omron", "a&d", "hem"]) or d.address.upper() == OMRON_MAC.upper():
            log.info(f"✅ Found: {name}  {d.address}")
            found = d
            break

    if not found:
        log.warning("⚠️  No Omron device found. Tips:")
        log.warning("   • Ensure Bluetooth is ON on this laptop")
        log.warning("   • Hold the MEMORY button on Omron for 3 seconds")
        log.warning("   • Move Omron within 1 metre of laptop")
    return found

# ══════════════════════════════════════════════
#  TAKE ONE READING
# ══════════════════════════════════════════════
async def take_reading(address: str = None) -> dict:
    """Connect to Omron, get one BP reading, disconnect."""

    # Use hardcoded MAC if no address given — faster, no scan needed
    if not address:
        address = OMRON_MAC
        log.info(f"📍 Using saved device: {OMRON_NAME}")
        log.info(f"   Address: {address}")

    received = None
    event    = asyncio.Event()

    def on_notify(sender, data):
        nonlocal received
        log.info(f"📡 BP data received ({len(data)} bytes)")
        r = parse_bp(bytearray(data))
        if r:
            received = r
            log.info(f"   Systolic:  {r.get('systolic')} mmHg")
            log.info(f"   Diastolic: {r.get('diastolic')} mmHg")
            log.info(f"   Pulse:     {r.get('pulse_rate','--')} bpm")
            event.set()

    try:
        log.info(f"📶 Connecting to {address}...")
        async with BleakClient(address) as client:
            log.info("✅ Connected")

            # Sync time to Omron (optional but helps timestamps)
            try:
                now = datetime.now()
                tb  = bytearray([
                    now.year & 0xFF, (now.year >> 8) & 0xFF,
                    now.month, now.day, now.hour, now.minute, now.second,
                    now.weekday() + 1, 0, 0
                ])
                await client.write_gatt_char(CURRENT_TIME_UUID, tb)
                log.info("⏰ Time synced")
            except:
                pass

            # Subscribe to BP notifications
            await client.start_notify(BP_MEASUREMENT_UUID, on_notify)
            log.info("👂 Waiting for reading — press START on Omron monitor")

            try:
                await asyncio.wait_for(event.wait(), timeout=90)
            except asyncio.TimeoutError:
                log.warning("⏱️  Timed out — no reading in 90 seconds")

            await client.stop_notify(BP_MEASUREMENT_UUID)

    except Exception as e:
        log.error(f"❌ Bluetooth error: {e}")
        return None

    if received:
        push_reading(received)
        sync_offline()

    return received

# ══════════════════════════════════════════════
#  SCAN ONLY MODE
# ══════════════════════════════════════════════
async def scan_only():
    print("\n🔍 Scanning for all Bluetooth devices (10 seconds)...\n")
    async with BleakScanner() as scanner:
        await asyncio.sleep(10)
        devices = scanner.discovered_devices

    print(f"Found {len(devices)} device(s):\n")
    print(f"  {'Name':35s}  {'Address':20s}")
    print(f"  {'-'*35}  {'-'*20}")
    for d in devices:
        name = d.name or "(no name)"
        print(f"  {name:35s}  {d.address}")

    print("\nOmron devices usually named: BLEsmart_XXXXXXXX or start with A&D")

# ══════════════════════════════════════════════
#  AUTO LOOP
# ══════════════════════════════════════════════
async def auto_loop():
    log.info(f"⏱️  Auto mode — reading every {AUTO_INTERVAL_MINUTES} minutes")
    log.info("   Press Ctrl+C to stop\n")

    while True:
        print(f"\n{'='*52}")
        print(f"  🩺  {PATIENT_NAME} · {BED_NUMBER}")
        print(f"  🕐  {datetime.now().strftime('%d %b %Y  %H:%M:%S')}")
        print(f"{'='*52}")
        await take_reading()
        log.info(f"⏳ Next reading in {AUTO_INTERVAL_MINUTES} minutes...")
        await asyncio.sleep(AUTO_INTERVAL_MINUTES * 60)

# ══════════════════════════════════════════════
#  MANUAL MENU
# ══════════════════════════════════════════════
async def manual_menu():
    print("""
╔══════════════════════════════════════════╗
║   MANUAL READING — Samarthaa ICU         ║
╚══════════════════════════════════════════╝
""")
    while True:
        print(f"Patient: {PATIENT_NAME} ({BED_NUMBER})")
        print("\n  1. Take reading now")
        print("  2. Scan for Bluetooth devices")
        print("  0. Exit\n")

        choice = input("Enter number: ").strip()

        if choice == "0":
            break
        elif choice == "2":
            await scan_only()
        elif choice == "1":
            print(f"\n→ Place cuff on patient and press START on Omron...\n")
            result = await take_reading()
            if result:
                print(f"\n  ✅ Reading complete:")
                print(f"     BP:    {result.get('systolic')}/{result.get('diastolic')} mmHg")
                print(f"     Pulse: {result.get('pulse_rate','--')} bpm")
                print(f"     Sent to VitalWatch dashboard ✓")
            else:
                print("\n  ❌ No reading received. Try again.\n")

# ══════════════════════════════════════════════
#  MAIN
# ══════════════════════════════════════════════
async def main():
    print("""
╔══════════════════════════════════════════════════════╗
║       Omron Bridge — Samarthaa Hospital              ║
║       ICU Ward 6A · VitalWatch v2.4                  ║
╚══════════════════════════════════════════════════════╝
""")
    print(f"  Patient:  {PATIENT_NAME} ({BED_NUMBER})")
    print(f"  Server:   {VITALWATCH_URL}")
    print(f"  Interval: Every {AUTO_INTERVAL_MINUTES} minutes\n")

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
        print("\n\n👋 Bridge stopped.")
