# ID Card Printing Software Free - Copyright (c) 2026 Josh McNabb. All rights reserved.
"""Builds the Inno Setup wizard images used by installer/setup.iss.

    python3 make-images.py        (needs Pillow)

Writes, next to this file:
  wizard-large-<scale>.png  WizardImageFile      - Finish/Welcome page panel (164:314)
  wizard-small-<scale>.png  WizardSmallImageFile - header of every inner page (square, transparent)

Sizes are the image-area sizes from the Inno Setup 6.6+ help topics for 100-200 % DPI;
Setup picks the best-matching file per DPI from the comma-separated list in setup.iss.
Look matches the app's sign-in panel (web/app.css .login-art): brand gradient with the
woven diagonal texture fading in over the bottom 38 %, app mark on top.
"""
import math
from pathlib import Path

from PIL import Image, ImageFilter

HERE = Path(__file__).resolve().parent
MARK = HERE.parent.parent / "web" / "img" / "mark.png"

# web/app.css: --brand-deep, --brand, --brand-mid; linear-gradient(160deg, deep, brand 60%, mid)
BRAND_DEEP, BRAND, BRAND_MID = (0x1F, 0x4D, 0x78), (0x00, 0x52, 0x9F), (0x2E, 0x74, 0xB5)
STOPS = ((0.0, BRAND_DEEP), (0.6, BRAND), (1.0, BRAND_MID))
GRADIENT_ANGLE = 160
WEAVE_TOP, WEAVE_STRIPE, WEAVE_ALPHA = 0.62, 14, 0.07  # bottom 38 %, 14 px stripes, white at 7 %

LARGE = {100: (202, 386), 125: (269, 515), 150: (336, 643), 175: (403, 772), 200: (430, 824)}
SMALL = {100: 58, 125: 77, 150: 97, 175: 116, 200: 124}


def gradient_colour(t):
    t = min(max(t, 0.0), 1.0)
    for (t0, c0), (t1, c1) in zip(STOPS, STOPS[1:]):
        if t <= t1:
            f = (t - t0) / (t1 - t0)
            return tuple(round(a + (b - a) * f) for a, b in zip(c0, c1))
    return STOPS[-1][1]


def background(w, h, scale):
    """Brand gradient (CSS 160deg) with the woven 45/135deg stripes over the bottom band."""
    lut = [gradient_colour(i / 1023) for i in range(1024)]
    ang = math.radians(GRADIENT_ANGLE)
    s, c = math.sin(ang), math.cos(ang)
    length = abs(w * s) + abs(h * c)
    stripe = WEAVE_STRIPE * scale / 100
    weave_y0 = h * WEAVE_TOP
    px = []
    for y in range(h):
        fade = max(0.0, (y - weave_y0) / (h - weave_y0))
        for x in range(w):
            t = ((x - w / 2) * s - (y - h / 2) * c) / length + 0.5
            r, g, b = lut[int(t * 1023) if 0 <= t <= 1 else (0 if t < 0 else 1023)]
            if fade:
                a1 = WEAVE_ALPHA if (x + y) * 0.7071 % (2 * stripe) < stripe else 0.0
                a2 = WEAVE_ALPHA if (x - y) * 0.7071 % (2 * stripe) < stripe else 0.0
                cover = (a1 + a2 - a1 * a2) * fade
                r, g, b = (round(v + (255 - v) * cover) for v in (r, g, b))
            px.append((r, g, b))
    im = Image.new("RGB", (w, h))
    im.putdata(px)
    return im


def mark(size):
    return Image.open(MARK).convert("RGBA").resize((size, size), Image.LANCZOS)


def large(w, h, scale):
    im = background(w, h, scale).convert("RGBA")
    m = mark(round(w * 0.5))
    cx, cy = w // 2, round(h * 0.4)  # optical centre, level with the Finish-page text block
    pad = m.width // 2
    shadow = Image.new("RGBA", (m.width + 2 * pad, m.height + 2 * pad), (0, 0, 0, 0))
    shadow.paste((0, 0, 0, 115), (pad, pad, pad + m.width, pad + m.height), m)
    shadow = shadow.filter(ImageFilter.GaussianBlur(m.width * 0.09))
    im.alpha_composite(shadow, (cx - shadow.width // 2, cy - shadow.height // 2 + round(m.width * 0.08)))
    im.alpha_composite(m, (cx - m.width // 2, cy - m.height // 2))
    return im.convert("RGB")


def small(n):
    im = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    m = mark(round(n * 0.8))
    im.alpha_composite(m, ((n - m.width) // 2, (n - m.height) // 2))
    return im


def main():
    if not MARK.is_file():
        raise SystemExit(f"app mark not found: {MARK}")
    for scale, (w, h) in LARGE.items():
        out = HERE / f"wizard-large-{scale}.png"
        large(w, h, scale).save(out, optimize=True)
        assert Image.open(out).size == (w, h), out
        print(out.name, f"{w}x{h}")
    for scale, n in SMALL.items():
        out = HERE / f"wizard-small-{scale}.png"
        small(n).save(out, optimize=True)
        assert Image.open(out).size == (n, n) and Image.open(out).mode == "RGBA", out
        print(out.name, f"{n}x{n}")


if __name__ == "__main__":
    main()
