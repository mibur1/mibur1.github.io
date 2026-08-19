#!/usr/bin/env python3
"""
Build content/publications.json from a Google Scholar profile.

Scholar is the source of truth for WHICH papers exist and for citation counts —
it is far more complete than ORCID, which has to be curated by hand. But the
profile page gives no DOIs, no open-access links and only abbreviated author
lists, so each title is matched against Crossref to recover its DOI, and the DOI
is then looked up in OpenAlex for the full author list and any free PDF.

Why both, when OpenAlex could in principle do the title lookup too: OpenAlex's
SEARCH index lags its record store. Measured on this profile, searching OpenAlex
by title found only 4 of 6 papers — the two most recent were missing — while
looking those same two up BY DOI returned complete records. Crossref, where
publishers deposit at publication time, found all six. So Crossref finds, and
OpenAlex enriches. Dropping either one loses recent papers or author lists.

    python scripts/fetch_publications.py

"""

from __future__ import annotations

import html
import json
import re
import sys
import time
from difflib import SequenceMatcher
from pathlib import Path
from urllib.parse import urlparse

import requests
import yaml

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "content" / "publications.json"
SITE = yaml.safe_load((ROOT / "site.yaml").read_text(encoding="utf-8"))

SCHOLAR_ID = SITE.get("scholar")
MAILTO = "michaburkhardt96@gmail.com"          # Crossref/OpenAlex polite pool
UA = ("Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0")
TIMEOUT = 30
TITLE_MATCH = 0.87                              # min similarity to trust a DOI

# OpenAlex marks plenty of repository deposits (PubMed Central, university
# archives) as "submittedVersion" even when they hold the accepted or published
# text. Only these hosts are genuinely preprint servers, so only these earn a
# "Preprint" link — otherwise the label would be wrong on most papers.
PREPRINT_HOSTS = (
    "biorxiv.org", "medrxiv.org", "arxiv.org", "psyarxiv.com",
    "osf.io", "ssrn.com", "researchsquare.com", "preprints.org",
    "chemrxiv.org", "hal.science", "zenodo.org",
)


def norm(t: str) -> str:
    return re.sub(r"[^a-z0-9 ]", "", (t or "").lower()).strip()


def strip_tags(s: str) -> str:
    return html.unescape(re.sub(r"<[^>]+>", "", s or "")).strip()


# ----------------------------------------------------------------- scholar
def scholar_rows() -> list[dict]:
    """Scrape every row of the profile's publication table."""
    if not SCHOLAR_ID:
        print("No `scholar:` id in site.yaml.", file=sys.stderr)
        return []

    out, start = [], 0
    while True:
        # sortby=pubdate gives Scholar's "sort by year" ordering, which is the
        # fallback when a paper has no exact date from OpenAlex.
        url = (f"https://scholar.google.com/citations?user={SCHOLAR_ID}"
               f"&hl=en&sortby=pubdate&cstart={start}&pagesize=100")
        try:
            r = requests.get(url, headers={"User-Agent": UA,
                                           "Accept-Language": "en-US,en;q=0.9"},
                             timeout=TIMEOUT)
            r.raise_for_status()
        except Exception as exc:  # noqa: BLE001
            print(f"  ! Scholar request failed: {exc}", file=sys.stderr)
            return out

        page = r.text
        if "gsc_a_tr" not in page:
            if re.search(r"captcha|unusual traffic|not a robot", page, re.I):
                print("  ! Scholar served a CAPTCHA — rate limited.", file=sys.stderr)
            break

        rows = re.findall(r'<tr class="gsc_a_tr">(.*?)</tr>', page, re.S)
        if not rows:
            break

        for row in rows:
            title = re.search(r'class="gsc_a_at"[^>]*>([^<]*)', row)
            grey = re.findall(r'class="gs_gray">(.*?)</div>', row, re.S)
            cites = re.search(r'class="gsc_a_ac[^"]*"[^>]*>([^<]*)', row)
            year = re.search(r'class="gsc_a_h[^"]*"[^>]*>([^<]*)', row)
            if not title:
                continue
            venue = strip_tags(grey[1]) if len(grey) > 1 else None
            # Scholar appends ", <year>" and often volume/pages to the venue
            if venue:
                venue = re.sub(r",?\s*\d{4}\s*$", "", venue).strip(" ,")
            out.append({
                "order": len(out),          # Scholar's own date ordering
                "title": strip_tags(title.group(1)),
                "scholar_authors": strip_tags(grey[0]) if grey else None,
                "venue": venue,
                "year": int(year.group(1)) if year and year.group(1).strip().isdigit() else None,
                "citations": int(cites.group(1)) if cites and cites.group(1).strip().isdigit() else 0,
            })

        if len(rows) < 100:
            break
        start += 100
        time.sleep(1.0)

    return out


# ------------------------------------------------------- doi + enrichment
def crossref_doi(title: str) -> str | None:
    """
    Find the DOI for a title, only accepting a close textual match.

    Crossref indexes preprints alongside the published article, and a preprint
    often matches the title just as well. Journal articles are therefore
    preferred, so a paper links to its version of record rather than the
    bioRxiv posting.
    """
    try:
        r = requests.get("https://api.crossref.org/works",
                         params={"query.bibliographic": title, "rows": 5,
                                 "select": "DOI,title,type", "mailto": MAILTO},
                         headers={"User-Agent": UA}, timeout=TIMEOUT)
        r.raise_for_status()
        items = r.json().get("message", {}).get("items", [])
    except Exception as exc:  # noqa: BLE001
        print(f"  ! Crossref: {exc}", file=sys.stderr)
        return None

    want = norm(title)
    matches = []
    for it in items:
        best = max((SequenceMatcher(None, want, norm(c)).ratio()
                    for c in (it.get("title") or [])), default=0.0)
        if best >= TITLE_MATCH and it.get("DOI"):
            matches.append((it["type"] == "posted-content", -best, it["DOI"].lower()))

    if not matches:
        return None
    matches.sort()           # journal articles first, then best similarity
    return matches[0][2]


def openalex(doi: str) -> dict | None:
    """Full author list, venue and open-access link for a DOI."""
    try:
        r = requests.get(f"https://api.openalex.org/works/doi:{doi}",
                         params={"mailto": MAILTO},
                         headers={"User-Agent": UA}, timeout=TIMEOUT)
        r.raise_for_status()
        d = r.json()
    except Exception:  # noqa: BLE001
        return None

    authors = []
    for a in d.get("authorships") or []:
        nm = (a.get("author") or {}).get("display_name")
        if nm:
            authors.append({"name": nm, "is_me": looks_like_me(nm)})
    # OpenAlex's best_oa_location happily returns a preprint when that is the
    # only free copy. Split the versions apart so the "PDF" button always means
    # the peer-reviewed article, and a preprint is offered as its own link.
    published = accepted = repository = preprint = None
    for loc in d.get("locations") or []:
        if not loc.get("is_oa"):
            continue
        url = loc.get("pdf_url") or loc.get("landing_page_url")
        if not url:
            continue
        version = loc.get("version")
        is_journal = ((loc.get("source") or {}).get("type") == "journal")

        if version == "publishedVersion":
            if published is None or is_journal:      # publisher copy wins
                published = url
        elif version == "acceptedVersion":
            if accepted is None:
                accepted = url
        elif version == "submittedVersion":
            # Only a genuine preprint server earns the "Preprint" label.
            # Anything else marked submittedVersion — an institutional
            # repository, PubMed Central — is in practice just a free copy of
            # the paper, so it becomes an ordinary PDF rather than being lost.
            if any(h in urlparse(url).netloc.lower() for h in PREPRINT_HOSTS):
                if preprint is None:
                    preprint = url
            elif repository is None:
                repository = url

    oa = d.get("open_access") or {}
    src = (d.get("primary_location") or {}).get("source") or {}
    return {
        "authors": authors,
        "date": d.get("publication_date"),   # YYYY-MM-DD, for within-year order
        # Best available free copy of the article itself: publisher version,
        # then accepted manuscript, then any repository copy.
        "oa_url": published or accepted or repository,
        "preprint_url": preprint,
        "oa_status": oa.get("oa_status"),
        "venue": src.get("display_name"),
        "type": d.get("type"),
    }


def looks_like_me(name: str) -> bool:
    parts = SITE["name"].split()
    given, family = parts[0], parts[-1]
    n = name.lower()
    return family.lower() in n and (given.lower() in n or f"{given[0].lower()}" in n)


def authors_from_scholar(s: str | None) -> list[dict]:
    """Fallback when no DOI was found. Scholar truncates long lists with '...'."""
    if not s:
        return []
    return [{"name": p.strip(), "is_me": looks_like_me(p)}
            for p in s.split(",") if p.strip() and p.strip() != "..."]


# ----------------------------------------------------------------- main
def main() -> int:
    print(f"Scraping Google Scholar profile {SCHOLAR_ID} …")
    rows = scholar_rows()
    if not rows:
        print("Nothing returned — keeping the existing publications.json.")
        return 0
    print(f"  {len(rows)} publication(s)")

    merged = []
    for row in rows:
        entry = {
            "title": row["title"],
            "year": row["year"],
            "venue": row["venue"],
            "citations": row["citations"],
            "order": row["order"],
            "doi": None,
            "authors": authors_from_scholar(row["scholar_authors"]),
        }

        doi = crossref_doi(row["title"])
        time.sleep(0.3)
        if doi:
            entry["doi"] = doi
            extra = openalex(doi)
            time.sleep(0.2)
            if extra:
                if extra["authors"]:
                    entry["authors"] = extra["authors"]
                for k in ("oa_url", "preprint_url", "oa_status", "type", "date"):
                    if extra.get(k):
                        entry[k] = extra[k]
                if extra.get("venue"):
                    entry["venue"] = extra["venue"]
            print(f"  · {doi}  {row['title'][:58]}")
        else:
            print(f"  · (no DOI) {row['title'][:58]}")

        merged.append(entry)

    # newest year first, then newest date within the year, then Scholar's order
    merged.sort(key=lambda e: (
        -(e.get("year") or 0),
        -int((e.get("date") or "0000-00-00").replace("-", "")),
        e.get("order", 0),
    ))

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(
        {"source": "google-scholar", "scholar": SCHOLAR_ID,
         "fetched": time.strftime("%Y-%m-%d", time.gmtime()),
         "publications": merged},
        indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Wrote {OUT.relative_to(ROOT)} ({len(merged)} entries)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
