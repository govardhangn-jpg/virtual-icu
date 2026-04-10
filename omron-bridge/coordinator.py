#!/usr/bin/env python3
"""
╔══════════════════════════════════════════════════════╗
║  MULTI-BED COORDINATOR                               ║
║  Samarthaa Hospital · ICU Ward 6A                    ║
║                                                      ║
║  Manages multiple Omron devices across all beds      ║
║  Run once on the nursing station laptop              ║
╚══════════════════════════════════════════════════════╝

Usage:
  python3 coordinator.py              # Start all beds
  python3 coordinator.py --bed P001  # Start single bed
  python3 coordinator.py --manual    # Manual reading menu
"""

import asyncio
import sys
import os
from datetime import datetime

# ══════════════════════════════════════════
#  BED CONFIGURATION
#  Add / remove beds here as needed
# ══════════════════════════════════════════
BEDS = [
    {
        "patient_id":   "P001",
        "patient_name": "Ramesh Kumar",
        "bed":          "Bed 01",
        "omron_mac":    "",   # Leave blank to auto-scan, or paste MAC address
        "interval_min": 15,
    },
    {
        "patient_id":   "P002",
        "patient_name": "Priya Sharma",
        "bed":          "Bed 02",
        "omron_mac":    "",
        "interval_min": 15,
    },
    {
        "patient_id":   "P003",
        "patient_name": "Anwar Khan",
        "bed":          "Bed 03",
        "omron_mac":    "",
        "interval_min": 10,   # More frequent for critical patient
    },
    {
        "patient_id":   "P004",
        "patient_name": "Leela Nair",
        "bed":          "Bed 04",
        "omron_mac":    "",
        "interval_min": 15,
    },
]

VITALWATCH_URL  = "https://virtual-icu.onrender.com"
VITALWATCH_KEY  = os.environ.get("VITALWATCH_API_KEY", "samarthaa-icu-2024")


# ══════════════════════════════════════════
#  MANUAL READING MENU
# ══════════════════════════════════════════
async def manual_menu():
    """Interactive menu for nurses to take manual readings."""
    from omron_bridge import take_reading

    print("""
╔══════════════════════════════════════════╗
║   MANUAL READING — Samarthaa ICU         ║
╚══════════════════════════════════════════╝
""")
    while True:
        print("\nSelect patient:")
        for i, bed in enumerate(BEDS):
            print(f"  {i+1}. {bed['patient_name']:25s} ({bed['bed']})")
        print("  0. Exit")

        try:
            choice = input("\nEnter number: ").strip()
            if choice == '0':
                break
            idx = int(choice) - 1
            if 0 <= idx < len(BEDS):
                bed = BEDS[idx]
                print(f"\n→ Taking reading for {bed['patient_name']} ({bed['bed']})")
                print("  Bring Omron monitor close to laptop and press START...")

                # Temporarily override config for this patient
                import omron_bridge as ob
                ob.PATIENT_ID   = bed['patient_id']
                ob.PATIENT_NAME = bed['patient_name']
                ob.BED_NUMBER   = bed['bed']

                result = await take_reading(bed.get('omron_mac') or None)

                if result:
                    print(f"\n  ✅ {bed['patient_name']}")
                    print(f"     BP:    {result.get('systolic')}/{result.get('diastolic')} mmHg")
                    print(f"     Pulse: {result.get('pulse_rate', 'N/A')} bpm")
                    print(f"     Time:  {datetime.now().strftime('%H:%M:%S')}")
                    print(f"     → Sent to VitalWatch dashboard")
                else:
                    print(f"\n  ❌ No reading. Try again — press START on Omron first")
        except (ValueError, KeyboardInterrupt):
            break


# ══════════════════════════════════════════
#  AUTO LOOP PER BED
# ══════════════════════════════════════════
async def bed_loop(bed: dict):
    """Run auto-readings for a single bed."""
    import omron_bridge as ob
    import requests

    ob.PATIENT_ID   = bed['patient_id']
    ob.PATIENT_NAME = bed['patient_name']
    ob.BED_NUMBER   = bed['bed']

    interval = bed.get('interval_min', 15)
    mac      = bed.get('omron_mac') or None

    print(f"▶ Started auto-loop for {bed['patient_name']} ({bed['bed']}) — every {interval} min")

    while True:
        print(f"\n[{datetime.now().strftime('%H:%M')}] Reading {bed['patient_name']}...")
        await ob.take_reading(mac)
        await asyncio.sleep(interval * 60)


async def main():
    if '--manual' in sys.argv:
        await manual_menu()
        return

    if '--bed' in sys.argv:
        # Run single bed
        idx = sys.argv.index('--bed')
        pid = sys.argv[idx + 1] if idx + 1 < len(sys.argv) else None
        beds = [b for b in BEDS if b['patient_id'] == pid]
        if not beds:
            print(f"Bed {pid} not found")
            return
    else:
        beds = BEDS

    print(f"""
╔══════════════════════════════════════════════════════╗
║   VitalWatch Multi-Bed Coordinator                   ║
║   Samarthaa Hospital · ICU Ward 6A                   ║
╚══════════════════════════════════════════════════════╝

  Monitoring {len(beds)} bed(s) — Press Ctrl+C to stop
""")

    # Run all beds concurrently
    tasks = [bed_loop(bed) for bed in beds]
    try:
        await asyncio.gather(*tasks)
    except KeyboardInterrupt:
        print("\n👋 Coordinator stopped.")


if __name__ == "__main__":
    asyncio.run(main())
