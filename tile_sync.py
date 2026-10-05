"""
CHS Tile Location Sync
=======================
Reads every Tile's last-known location straight from Tile's own cloud API via
pytile (https://github.com/bachya/pytile - the same library Home Assistant's
built-in Tile integration uses) and writes it to Firebase under
/tileLocations/{tileNo}.

Replaces the old BlueStacks-based tile_sync.py, which drove an Android
emulator over ADB and scraped the Tile app's UI one scroll at a time -
fragile (breaks on any Tile app UI change), and needed a machine left
running BlueStacks. This talks to Tile's backend directly over HTTPS, so it
has no UI to scrape and runs anywhere - including the scheduled GitHub
Action in .github/workflows/tile-sync.yml, with no dedicated machine needed.

Matches tiles by the number before the ')' in the tile's name, e.g.:
  "56) V60 Sevoflurane QuikFil SN:DKJ48559543 #100252"  ->  TileNo = 56

Run manually:  python tile_sync.py          (needs TILE_EMAIL/TILE_PASSWORD
                                              in the environment)
Scheduled:     .github/workflows/tile-sync.yml (daily)

SETUP
-----
1. pip install -r requirements.txt
2. Set TILE_EMAIL / TILE_PASSWORD - the same Tile account the BlueStacks
   setup used. Locally: set them as environment variables. In CI: GitHub
   repo secrets of the same name (see tile-sync.yml).
3. Addresses are reverse-geocoded via OpenStreetMap's free Nominatim API -
   no key or account needed, see reverse_geocode() below for its rate limit.
"""

import asyncio
import os
import re
import sys
from datetime import datetime, timezone

import aiohttp
from pytile import async_login
from pytile.errors import TileError

FIREBASE_URL = os.environ.get(
    "FIREBASE_URL",
    "https://chs-equipment-default-rtdb.asia-southeast1.firebasedatabase.app",
)
TILE_EMAIL = os.environ.get("TILE_EMAIL")
TILE_PASSWORD = os.environ.get("TILE_PASSWORD")

# Nominatim's usage policy requires a real identifying User-Agent and caps
# this at 1 request/second - see reverse_geocode()'s sleep in main().
NOMINATIM_USER_AGENT = "chs-equipment-tile-sync/1.0 (+https://github.com/CMCHSGit/chs-equipment)"

TILE_NAME_RE = re.compile(r"^\s*(\d+)\)")


def parse_tile_no(name):
    m = TILE_NAME_RE.match(name or "")
    return m.group(1) if m else None


def relative_time(dt):
    """Mimics the Tile app's own "25 min ago" style, computed from
    last_timestamp instead of scraped off the screen. pytile returns this as
    a naive UTC datetime (tzinfo stripped), so it's compared against a naive
    UTC "now" rather than an aware one."""
    if dt is None:
        return ""
    seconds = (datetime.now(timezone.utc).replace(tzinfo=None) - dt).total_seconds()
    if seconds < 60:
        return "just now"
    minutes = int(seconds // 60)
    if minutes < 60:
        return f"{minutes} min ago"
    hours = int(minutes // 60)
    if hours < 24:
        return f"{hours} hr ago"
    days = int(hours // 24)
    return f"{days} day{'s' if days != 1 else ''} ago"


async def reverse_geocode(session, lat, lon):
    try:
        async with session.get(
            "https://nominatim.openstreetmap.org/reverse",
            params={"format": "jsonv2", "lat": lat, "lon": lon, "zoom": 18},
            headers={"User-Agent": NOMINATIM_USER_AGENT},
            timeout=aiohttp.ClientTimeout(total=10),
        ) as resp:
            if resp.status != 200:
                return ""
            data = await resp.json()
    except Exception:
        return ""
    addr = data.get("address", {}) if isinstance(data, dict) else {}
    road = addr.get("road")
    area = addr.get("suburb") or addr.get("city") or addr.get("town") or addr.get("village")
    parts = [p for p in (road, area) if p]
    return ", ".join(parts) if parts else (data.get("display_name") or "")


async def main():
    if not TILE_EMAIL or not TILE_PASSWORD:
        print("ERROR: set TILE_EMAIL and TILE_PASSWORD")
        sys.exit(1)

    print("=" * 50)
    print("CHS Tile Location Sync")
    print(f"Started: {datetime.now().strftime('%d/%m/%Y %H:%M:%S')}")
    print("=" * 50)

    async with aiohttp.ClientSession() as session:
        print("Logging in to Tile...")
        try:
            api = await async_login(TILE_EMAIL, TILE_PASSWORD, session)
        except TileError as err:
            print(f"ERROR: Tile login failed: {err}")
            sys.exit(1)

        print("Fetching tiles...")
        tiles = await api.async_get_tiles()
        print(f"Tile account returned {len(tiles)} tile(s) total")

        records = {}
        skipped_no_location = 0
        # Reverse-geocoded sequentially (never concurrently) to respect
        # Nominatim's 1 request/second usage policy - see the sleep below.
        for tile in tiles.values():
            tile_no = parse_tile_no(tile.name)
            if not tile_no:
                continue  # not one of ours (no "N) " prefix) - leave alone
            if tile.latitude is None or tile.longitude is None:
                skipped_no_location += 1
                continue

            location = await reverse_geocode(session, tile.latitude, tile.longitude)
            await asyncio.sleep(1.1)

            # pytile's installed release (2024.12.0) doesn't expose a battery
            # property at all, but the raw API response underneath it does -
            # confirmed live against this account (result.battery_status is
            # "NONE"/"LEVEL1"/"LEVEL2"; last_tile_state.battery_level is a
            # finer-grained number whose exact scale isn't documented, so
            # it's stored but not used for the alert text below).
            result = tile._tile_data.get("result", {}) or {}
            last_state = result.get("last_tile_state") or {}
            battery_status = result.get("battery_status")
            battery_level = last_state.get("battery_level")

            if tile.dead:
                alert = "Tile is dead - replace the Tile"
            elif battery_status and battery_status != "NONE":
                alert = "Tile battery low - replace battery soon"
            elif tile.lost:
                alert = "Lost signal - no recent location update"
            else:
                alert = ""

            records[tile_no] = {
                "tileNo": tile_no,
                "tileName": tile.name,
                "location": location,
                "lastUpdated": relative_time(tile.last_timestamp),
                # Raw UTC timestamp of the tile's last location fix (not of
                # this sync run - that's syncedAt below) - the "X min ago"
                # text above goes stale between daily syncs, this doesn't.
                # pytile's datetime is naive-but-UTC (tzinfo stripped), hence
                # the explicit "Z" so the browser parses it as UTC.
                "lastTimestamp": (tile.last_timestamp.isoformat() + "Z") if tile.last_timestamp else None,
                "latitude": tile.latitude,
                "longitude": tile.longitude,
                "batteryStatus": battery_status or "",
                "batteryLevel": battery_level,
                "alert": alert,
                "syncedAt": datetime.now().strftime("%d/%m/%Y %H:%M"),
            }

        print(
            f"Matched {len(records)} numbered tile(s)"
            + (f", {skipped_no_location} with no location yet" if skipped_no_location else "")
        )

        print("Clearing old tile data from Firebase...")
        async with session.delete(f"{FIREBASE_URL}/tileLocations.json") as resp:
            if resp.status != 200:
                print(f"  WARNING: could not clear old data ({resp.status})")

        print(f"Writing {len(records)} tile(s) to Firebase...")
        success = 0
        for tile_no, payload in records.items():
            async with session.put(
                f"{FIREBASE_URL}/tileLocations/{tile_no}.json", json=payload
            ) as resp:
                if resp.status == 200:
                    success += 1
                else:
                    print(f"  WARNING: Firebase returned {resp.status} for tile {tile_no}")

        print(f"\nDone: {success}/{len(records)} tiles written.")
        print(f"Finished: {datetime.now().strftime('%d/%m/%Y %H:%M:%S')}")


if __name__ == "__main__":
    asyncio.run(main())
