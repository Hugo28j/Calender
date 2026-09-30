#!/usr/bin/env python3
"""
Merge the rolling VUB TimeEdit feed into a persistent calendar archive.

Policy:
- Every event in the fresh TimeEdit feed is authoritative.
- Events that disappeared from the fresh feed are kept only when they already
  started in the past. This preserves lesson history forever without keeping
  cancelled future lessons.
- UID is used as the stable event identity.
"""

from __future__ import annotations

import re
import sys
from datetime import datetime, timezone
from pathlib import Path


EVENT_RE = re.compile(r"BEGIN:VEVENT\r?\n.*?END:VEVENT\r?\n?", re.DOTALL | re.IGNORECASE)


def unfold(text: str) -> str:
    return re.sub(r"\r?\n[ \t]", "", text)


def field(block: str, name: str) -> str:
    flat = unfold(block)
    match = re.search(rf"^{re.escape(name)}(?:;[^:]*)?:(.*)$", flat, re.MULTILINE | re.IGNORECASE)
    return match.group(1).strip() if match else ""


def parse_dt(value: str) -> datetime | None:
    if not value:
        return None

    value = value.strip()
    formats = (
        ("%Y%m%dT%H%M%SZ", timezone.utc),
        ("%Y%m%dT%H%M%S", timezone.utc),
        ("%Y%m%dT%H%MZ", timezone.utc),
        ("%Y%m%dT%H%M", timezone.utc),
        ("%Y%m%d", timezone.utc),
    )

    for fmt, tz in formats:
        try:
            return datetime.strptime(value, fmt).replace(tzinfo=tz)
        except ValueError:
            pass
    return None


def event_key(block: str) -> str:
    uid = field(block, "UID")
    if uid:
        return uid

    # Defensive fallback for malformed feeds without UID.
    return "|".join((
        field(block, "DTSTART"),
        field(block, "SUMMARY"),
        field(block, "LOCATION"),
    ))


def extract_events(text: str) -> list[str]:
    return EVENT_RE.findall(text)


def calendar_shell(text: str) -> tuple[str, str]:
    first = re.search(r"BEGIN:VEVENT\r?\n", text, re.IGNORECASE)
    if not first:
        raise ValueError("ICS contains no VEVENT")

    matches = list(EVENT_RE.finditer(text))
    if not matches:
        raise ValueError("ICS contains no complete VEVENT")

    prefix = text[: first.start()]
    suffix = text[matches[-1].end():]

    if "BEGIN:VCALENDAR" not in prefix.upper():
        raise ValueError("Missing BEGIN:VCALENDAR")
    if "END:VCALENDAR" not in suffix.upper():
        suffix = "END:VCALENDAR\n"

    return prefix, suffix


def sort_key(block: str):
    dt = parse_dt(field(block, "DTSTART"))
    return dt or datetime.max.replace(tzinfo=timezone.utc)


def merge(existing_text: str, fresh_text: str) -> tuple[str, int, int, int]:
    fresh_events = extract_events(fresh_text)
    if not fresh_events:
        raise ValueError("Fresh TimeEdit feed contains no events")

    old_events = extract_events(existing_text) if existing_text else []
    now = datetime.now(timezone.utc)

    # Fresh feed wins for every UID it currently contains.
    merged: dict[str, str] = {}
    for block in fresh_events:
        merged[event_key(block)] = block

    archived = 0
    for block in old_events:
        key = event_key(block)
        if key in merged:
            continue

        start = parse_dt(field(block, "DTSTART"))
        if start is not None and start < now:
            merged[key] = block
            archived += 1

    events = sorted(merged.values(), key=sort_key)
    prefix, suffix = calendar_shell(fresh_text)

    # Normalize boundaries without touching folded VEVENT content.
    out = prefix.rstrip("\r\n") + "\n"
    out += "".join(
        block if block.endswith(("\n", "\r")) else block + "\n"
        for block in events
    )
    out += suffix.lstrip("\r\n")
    if not out.endswith("\n"):
        out += "\n"

    return out, len(old_events), len(fresh_events), archived


def main() -> int:
    if len(sys.argv) != 4:
        print("usage: merge_timeedit.py EXISTING.ics FRESH.ics OUTPUT.ics", file=sys.stderr)
        return 2

    existing_path = Path(sys.argv[1])
    fresh_path = Path(sys.argv[2])
    output_path = Path(sys.argv[3])

    existing = existing_path.read_text(encoding="utf-8") if existing_path.exists() else ""
    fresh = fresh_path.read_text(encoding="utf-8")

    merged, old_count, fresh_count, archived_count = merge(existing, fresh)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(merged, encoding="utf-8")

    total = len(extract_events(merged))
    print(
        f"TimeEdit merge complete: fresh={fresh_count}, "
        f"previous={old_count}, preserved_history={archived_count}, total={total}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
