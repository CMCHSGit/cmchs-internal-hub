"""
Tile sync's side of the hub's Firestore (the staff schedule's Firebase project)
==============================================================================
After the demo tracker's cutover (STEP-5-PLAN.md) the tracker reads each
Tile's last-seen place from Firestore `tileLocations/{tileNo}` instead of the
old Realtime Database. This talks to Firestore's REST API directly (no extra
library beyond google-auth, which tile_sync.py already needs), signed with the
hub's service account: the same FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL /
FIREBASE_PRIVATE_KEY secrets the Thursday reminder uses. A service account is
not held to the security rules, which let nobody write tileLocations from a
browser.

It also reads `settings/equipmentCutover` (which database the tracker is on),
so tile_sync.py writes where the tracker is reading.

Never prints names or addresses: counts only.
"""

import os

DOCS = "https://firestore.googleapis.com/v1/projects/{pid}/databases/(default)/documents"
COLLECTION = "tileLocations"
BATCH = 400  # a commit takes up to 500 writes

TARGETS = ("auto", "rtdb", "firestore", "both")


def credentials_info(env=os.environ):
    """The service account as google-auth wants it, from the three secrets; None if any is missing."""
    pid, email, key = env.get("FIREBASE_PROJECT_ID"), env.get("FIREBASE_CLIENT_EMAIL"), env.get("FIREBASE_PRIVATE_KEY")
    if not (pid and email and key):
        return None
    return {
        "type": "service_account",
        "project_id": pid,
        "client_email": email,
        # GitHub secrets keep the key's newlines as a backslash and an n
        "private_key": key.replace("\\n", "\n"),
        "token_uri": "https://oauth2.googleapis.com/token",
    }


def access_token(info):
    """An OAuth token for Firestore (blocking: one quick call to Google)."""
    from google.oauth2 import service_account
    from google.auth.transport.requests import Request

    creds = service_account.Credentials.from_service_account_info(
        info, scopes=["https://www.googleapis.com/auth/datastore"]
    )
    creds.refresh(Request())
    return creds.token


def choose_target(requested, source):
    """Where to write: 'rtdb', 'firestore' or 'both'.

    requested is TILE_SYNC_TARGET: 'auto' follows the tracker's switch
    (settings/equipmentCutover.source), the others force it (a manual run before
    the cutover can fill Firestore ahead with 'both'). If the switch can't be
    read (source None), 'auto' stays on the old database, so nothing changes
    until the tracker really has moved."""
    requested = (requested or "auto").strip().lower()
    if requested not in TARGETS:
        raise ValueError(f"TILE_SYNC_TARGET must be one of {', '.join(TARGETS)}")
    if requested != "auto":
        return requested
    return "firestore" if source == "firestore" else "rtdb"


def to_value(v):
    """A Python value as a Firestore REST value."""
    if v is None:
        return {"nullValue": None}
    if isinstance(v, bool):
        return {"booleanValue": v}
    if isinstance(v, int):
        return {"integerValue": str(v)}
    if isinstance(v, float):
        return {"doubleValue": v}
    return {"stringValue": str(v)}


def to_fields(record):
    return {k: to_value(v) for k, v in record.items()}


def plan_writes(pid, records, existing_ids):
    """The commit's writes: every record set whole, and any tile no longer in
    the sync (a Tile removed from the account) deleted. With no records at all
    nothing is deleted, so a failed or empty fetch never wipes the places."""
    base = f"projects/{pid}/databases/(default)/documents"
    writes = [
        {"update": {"name": f"{base}/{COLLECTION}/{no}", "fields": to_fields(rec)}}
        for no, rec in records.items()
    ]
    if records:
        writes += [{"delete": f"{base}/{COLLECTION}/{no}"} for no in sorted(existing_ids) if no not in records]
    return writes


def batches(writes, size=BATCH):
    for i in range(0, len(writes), size):
        yield writes[i : i + size]


async def read_source(session, pid, token):
    """settings/equipmentCutover.source ('rtdb' | 'firestore'), or None if it can't be read."""
    async with session.get(
        f"{DOCS.format(pid=pid)}/settings/equipmentCutover", headers={"Authorization": f"Bearer {token}"}
    ) as resp:
        if resp.status == 404:
            return "rtdb"  # never set: the tracker is on the old database
        if resp.status != 200:
            return None
        data = await resp.json()
    return (data.get("fields", {}).get("source", {}) or {}).get("stringValue") or "rtdb"


async def existing_ids(session, pid, token):
    """The tile numbers already in tileLocations."""
    ids, page = [], None
    while True:
        params = {"pageSize": "300", "mask.fieldPaths": "tileNo"}
        if page:
            params["pageToken"] = page
        async with session.get(
            f"{DOCS.format(pid=pid)}/{COLLECTION}", params=params, headers={"Authorization": f"Bearer {token}"}
        ) as resp:
            if resp.status != 200:
                raise RuntimeError(f"could not list {COLLECTION} ({resp.status})")
            data = await resp.json()
        ids += [d["name"].rsplit("/", 1)[1] for d in data.get("documents", [])]
        page = data.get("nextPageToken")
        if not page:
            return ids


async def write_records(session, pid, token, records):
    """Sets every record and removes the ones that are gone, in a few commits.
    Returns (written, deleted, failed): counts of writes."""
    writes = plan_writes(pid, records, await existing_ids(session, pid, token))
    written = deleted = failed = 0
    for chunk in batches(writes):
        async with session.post(
            f"{DOCS.format(pid=pid)}:commit", json={"writes": chunk}, headers={"Authorization": f"Bearer {token}"}
        ) as resp:
            if resp.status == 200:
                written += sum(1 for w in chunk if "update" in w)
                deleted += sum(1 for w in chunk if "delete" in w)
            else:
                failed += len(chunk)
                print(f"  WARNING: Firestore returned {resp.status} for a batch of {len(chunk)}")
    return written, deleted, failed
