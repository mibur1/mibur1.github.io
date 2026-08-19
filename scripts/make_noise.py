#!/usr/bin/env python3
"""
Generate the two static grain tiles used as a paper-texture overlay.

  static/img/noise-light.png  dark pixels, composited with `multiply`
  static/img/noise-dark.png   light pixels, composited with `screen`

Deterministic (fixed seed), so re-running produces identical files and the
repo sees no spurious diff. Run again only if you want to change the texture:

    python scripts/make_noise.py
"""

from __future__ import annotations

import random
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "static" / "img"

SIZE = 256          # tile edge, px
COVERAGE = 0.55     # fraction of pixels that carry any grain at all
MAX_ALPHA = 26      # peak alpha; kept low so the texture reads as paper, not dots
SEED = 20260819


def make(channel: int, name: str) -> None:
    rng = random.Random(SEED)
    img = Image.new("RGBA", (SIZE, SIZE), (channel, channel, channel, 0))
    px = img.load()
    for y in range(SIZE):
        for x in range(SIZE):
            if rng.random() < COVERAGE:
                px[x, y] = (channel, channel, channel, rng.randint(1, MAX_ALPHA))
    path = OUT / name
    img.save(path, "PNG", optimize=True)
    print(f"Wrote {path.relative_to(ROOT)} ({path.stat().st_size // 1024} KB)")


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    make(0, "noise-light.png")     # black grain, multiplied onto light paper
    make(255, "noise-dark.png")    # white grain, screened onto dark paper
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
