#!/usr/bin/env python3
"""
Fetch publications from ORCID, enrich them from OpenAlex, write content/publications.json.

ORCID is the source of truth for *which* works are yours; it does not return
author lists, so OpenAlex fills in authors, venue, open-access links and
citation counts by DOI.

This script never touches content/publications.overrides.yml — curation lives
there and is applied at build time, so regenerating cannot clobber your edits.

Fails safe: if the APIs are unreachable or return nothing, the existing
publications.json is left untouched rather than replaced with an empty list.
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import requests
import yaml

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "content" / "publications.json"
SITE = yaml.safe_load((ROOT / "site.yaml").read_text(encoding="utf-8"))

ORCID = SITE["orcid"]
MAILTO = "michaburkhardt96@gmail.com"  # OpenAlex polite pool
UA = f"michaburkhardt.de/1.0 (mailto:{MAILTO})"
TIMEOUT = 30


def get_json(url: str, **params) -> dict | None:
    try:
        r = requests.get(
            url,
            params=params or None,
            headers={"Accept": "application/json", "User-Agent": UA},
            timeout=TIMEOUT,
        )
        r.raise_for_status()
        return r.json()
    except Exception as exc:  # noqa: BLE001 — any failure means "skip, keep cache"
        print(f"  ! {url} -> {exc}", file=sys.stderr)
        return None


def orcid_works() -> list[dict]:
    """Return [{doi, title, year, journal, type}] from the ORCID public API."""
    data = get_json(f"https://pub.orcid.org/v3.0/{ORCID}/works")
    if not data:
        return []

    works = []
    for group in data.get("group") or []:
        summary = (group.get("work-summary") or [{}])[0]

        doi = None
        for ext in (group.get("external-ids") or {}).get("external-id") or []:
            if (ext.get("external-id-type") or "").lower() == "doi":
                doi = (ext.get("external-id-value") or "").strip().lower()
                break

        title = (((summary.get("title") or {}).get("title")) or {}).get("value")
        year = (((summary.get("publication-date") or {}).get("year")) or {}).get("value")

        works.append(
            {
                "doi": doi,
                "title": title,
                "year": int(year) if year and str(year).isdigit() else None,
                "venue": (summary.get("journal-title") or {}).get("value"),
                "type": summary.get("type"),
            }
        )
    return works


def openalex(doi: str) -> dict | None:
    """Enrich a DOI with authors, venue, OA link and citation count."""
    data = get_json(f"https://api.openalex.org/works/doi:{doi}", mailto=MAILTO)
    if not data:
        return None

    authors = []
    for a in data.get("authorships") or []:
        author = a.get("author") or {}
        name = author.get("display_name")
        if not name:
            continue
        orcid_url = author.get("orcid") or ""
        authors.append(
            {
                "name": name,
                # Match on ORCID when present, else fall back to surname+initial
                "is_me": ORCID in orcid_url or _looks_like_me(name),
            }
        )

    oa = data.get("open_access") or {}
    source = (data.get("primary_location") or {}).get("source") or {}

    return {
        "title": data.get("title"),
        "year": data.get("publication_year"),
        "venue": source.get("display_name"),
        "authors": authors,
        "oa_url": oa.get("oa_url"),
        "oa_status": oa.get("oa_status"),
        "citations": data.get("cited_by_count") or 0,
        "type": data.get("type"),
    }


def _looks_like_me(name: str) -> bool:
    """Fallback author match when OpenAlex has no ORCID for the record."""
    parts = SITE["name"].split()
    given, family = parts[0], parts[-1]
    n = name.lower()
    return family.lower() in n and (given.lower() in n or f"{given[0].lower()}." in n)


def main() -> int:
    print(f"Fetching ORCID {ORCID} …")
    works = orcid_works()
    if not works:
        print("No works returned from ORCID — keeping existing publications.json.")
        return 0

    print(f"  {len(works)} work group(s) from ORCID")

    merged = []
    for w in works:
        entry = dict(w)
        if w["doi"]:
            print(f"  · OpenAlex {w['doi']}")
            extra = openalex(w["doi"])
            if extra:
                # OpenAlex wins on fields ORCID leaves empty or vaguer
                for key in ("authors", "oa_url", "oa_status", "citations"):
                    if extra.get(key):
                        entry[key] = extra[key]
                for key in ("title", "venue", "year", "type"):
                    if not entry.get(key) and extra.get(key):
                        entry[key] = extra[key]
                if extra.get("venue"):
                    entry["venue"] = extra["venue"]
            time.sleep(0.15)  # be polite
        merged.append(entry)

    merged.sort(key=lambda e: (e.get("year") or 0), reverse=True)

    payload = {
        "orcid": ORCID,
        "fetched": time.strftime("%Y-%m-%d", time.gmtime()),
        "publications": merged,
    }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Wrote {OUT.relative_to(ROOT)} ({len(merged)} entries)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
