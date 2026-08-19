#!/usr/bin/env python3
"""
Generate static/img/og.png preview card shown when the site is shared.

    python scripts/make_og_image.py
"""

from __future__ import annotations

import math
import random
from pathlib import Path

import yaml
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
FONTS = ROOT / "static" / "fonts"
OUT = ROOT / "static" / "img" / "og.png"

W, H = 1200, 630
PAPER = (251, 250, 247)
INK = (23, 23, 26)
INK_3 = (124, 124, 134)
ACCENT = (14, 106, 94)

SUBTITLE = "personal website"


def load_font(name: str, size: int):
    path = FONTS / name
    try:
        return ImageFont.truetype(str(path), size)
    except Exception:
        return ImageFont.load_default()


def main() -> int:
    site = yaml.safe_load((ROOT / "site.yaml").read_text(encoding="utf-8"))

    img = Image.new("RGB", (W, H), PAPER)
    d = ImageDraw.Draw(img, "RGBA")

    # Decorative network on the right — same motif as the hero canvas
    random.seed(7)
    pts = [(random.randint(760, 1160), random.randint(70, 560)) for _ in range(26)]
    for i, a in enumerate(pts):
        for b in pts[i + 1:]:
            dist = math.dist(a, b)
            if dist < 165:
                alpha = int(70 * (1 - dist / 165))
                d.line([a, b], fill=INK + (alpha,), width=1)
    for x, y in pts:
        r = random.randint(3, 7)
        d.ellipse([x - r, y - r, x + r, y + r], fill=INK + (190,))
    d.ellipse([955, 300, 985, 330], fill=ACCENT)

    # Text block: name, and one line under it. Nothing else.
    f_name = load_font("ibm-plex-sans-latin-600-normal.woff2", 88)
    f_sub = load_font("ibm-plex-sans-latin-400-normal.woff2", 34)

    name = site["name"]
    sub = SUBTITLE

    # Vertically centre the two lines as a block.
    nb = d.textbbox((0, 0), name, font=f_name)
    sb = d.textbbox((0, 0), sub, font=f_sub)
    gap = 26
    block_h = (nb[3] - nb[1]) + gap + (sb[3] - sb[1])
    top = (H - block_h) // 2

    d.text((80, top - nb[1]), name, font=f_name, fill=INK)
    d.text((80, top + (nb[3] - nb[1]) + gap - sb[1]), sub, font=f_sub, fill=INK_3)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    img.save(OUT, "PNG", optimize=True)
    print(f"Wrote {OUT.relative_to(ROOT)} ({OUT.stat().st_size // 1024} KB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
