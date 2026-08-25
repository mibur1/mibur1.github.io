#!/usr/bin/env python3
"""
Generate gallery thumbnails.

Full-size gallery images are ~1440px and a few hundred KB each. The grid shows
them at ~200px, so serving the originals as thumbnails would mean multiple MB
for a page of postage stamps. This writes a downscaled copy of every image in
static/img/<album>/ into static/img/<album>/thumbs/, which the grid uses; the
full image is only fetched when someone opens the lightbox.

    python scripts/make_thumbs.py            # all albums
    python scripts/make_thumbs.py vacation   # one album

Re-run after adding photos. Existing thumbnails are skipped unless the source
is newer, so it is cheap to run repeatedly.
"""

from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
IMG = ROOT / "static" / "img"
THUMB_PX = 420          # 2x the largest rendered size, for retina
QUALITY = 78
EXTS = {".webp", ".jpg", ".jpeg", ".png"}


def build_album(album: Path) -> None:
    out = album / "thumbs"
    out.mkdir(exist_ok=True)
    made = skipped = 0

    for src in sorted(album.iterdir()):
        if src.is_dir() or src.suffix.lower() not in EXTS:
            continue
        dst = out / (src.stem + ".webp")
        if dst.exists() and dst.stat().st_mtime >= src.stat().st_mtime:
            skipped += 1
            continue

        im = Image.open(src)
        im.thumbnail((THUMB_PX, THUMB_PX), Image.LANCZOS)
        im.save(dst, "WEBP", quality=QUALITY, method=6)
        made += 1

    total = sum(f.stat().st_size for f in out.glob("*.webp"))
    src_total = sum(f.stat().st_size for f in album.iterdir()
                    if f.is_file() and f.suffix.lower() in EXTS)
    print(f"  {album.name}: {made} made, {skipped} current — "
          f"{total // 1024} KB of thumbs for {src_total // 1024} KB of originals")


def main() -> int:
    names = sys.argv[1:]
    albums = [IMG / n for n in names] if names else [
        d for d in IMG.iterdir() if d.is_dir() and d.name != "thumbs"
    ]
    if not albums:
        print("No albums found in static/img/")
        return 1
    for a in albums:
        if not a.is_dir():
            print(f"  {a.name}: not a directory, skipped")
            continue
        build_album(a)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
