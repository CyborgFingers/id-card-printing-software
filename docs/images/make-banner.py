# ID Card Printing Software Free - Copyright (c) 2026 Josh McNabb. All rights reserved.
"""Draws the README banner (docs/images/banner.png, 2560 x 800 = 1280 x 400 at 2x).

    python3 -I make-banner.py        (needs Pillow; fonts come from web/fonts)

Look matches the program's sign-in panel and the installer's wizard image: the brand gradient
(deep -> brand -> mid at 160 deg) with the woven diagonal texture fading in over the bottom band,
the app mark, the product name and two illustrated sample cards. Corners are transparent so the
banner sits on GitHub's light and dark pages alike.
"""
import math
import random
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
FONTS = ROOT / "web" / "fonts"
MARK = ROOT / "web" / "img" / "mark.png"

W, H, RADIUS = 2560, 800, 44
BRAND_DEEP, BRAND, BRAND_MID, TINT = (0x1F, 0x4D, 0x78), (0x00, 0x52, 0x9F), (0x2E, 0x74, 0xB5), (0xE8, 0xF0, 0xF8)
INK, INK_2, SILHOUETTE = (0x0F, 0x1D, 0x2C), (0x4A, 0x58, 0x68), (0x2F, 0x5D, 0x8A)
STOPS = ((0.0, BRAND_DEEP), (0.6, BRAND), (1.0, BRAND_MID))
GRADIENT_ANGLE = 160
WEAVE_TOP, WEAVE_STRIPE, WEAVE_ALPHA = 0.62, 28, 0.07   # bottom 38 %, 14 px stripes at 2x, white at 7 %


def font(name, size):
    return ImageFont.truetype(str(FONTS / f"{name}-normal.woff2"), size)


def gradient_colour(t):
    t = min(max(t, 0.0), 1.0)
    for (t0, c0), (t1, c1) in zip(STOPS, STOPS[1:]):
        if t <= t1:
            f = (t - t0) / (t1 - t0)
            return tuple(round(a + (b - a) * f) for a, b in zip(c0, c1))
    return STOPS[-1][1]


def gradient(w, h):
    """The CSS 160deg gradient, computed at quarter size and scaled up (it is smooth anyway)."""
    sw, sh = w // 4, h // 4
    ang = math.radians(GRADIENT_ANGLE)
    s, c = math.sin(ang), math.cos(ang)
    length = abs(sw * s) + abs(sh * c)
    px = [gradient_colour(((x - sw / 2) * s - (y - sh / 2) * c) / length + 0.5) for y in range(sh) for x in range(sw)]
    im = Image.new("RGB", (sw, sh))
    im.putdata(px)
    return im.resize((w, h), Image.BICUBIC)


def weave(w, h):
    """White 45/135 deg stripes as an alpha mask, fading in from WEAVE_TOP to the bottom edge."""
    stripes = Image.new("L", (w, h), 0)
    d = ImageDraw.Draw(stripes)
    period = 2 * WEAVE_STRIPE
    span = w + h
    for k in range(-span // period - 1, span // period + 2):
        o = k * period * math.sqrt(2)   # perpendicular period -> horizontal offset
        d.line([(o - h, h), (o, 0)], fill=255, width=WEAVE_STRIPE)   # 45 deg
        d.line([(o, 0), (o + h, h)], fill=255, width=WEAVE_STRIPE)   # 135 deg
    fade = Image.new("L", (1, h))
    y0 = h * WEAVE_TOP
    fade.putdata([round(255 * max(0.0, (y - y0) / (h - y0))) for y in range(h)])
    fade = fade.resize((w, h))
    mask = stripes.point(lambda v: round(v * WEAVE_ALPHA))
    return Image.composite(mask, Image.new("L", (w, h), 0), fade)


def background():
    im = gradient(W, H).convert("RGBA")
    white = Image.new("RGBA", (W, H), (255, 255, 255, 255))
    im = Image.composite(white, im, weave(W, H))
    rounded = Image.new("L", (W, H), 0)
    ImageDraw.Draw(rounded).rounded_rectangle((0, 0, W - 1, H - 1), radius=RADIUS, fill=255)
    im.putalpha(rounded)
    return im


def shadowed(im, canvas, pos, blur, alpha=110, dy=18):
    """Paste im at pos with a soft drop shadow underneath."""
    pad = blur * 3
    sh = Image.new("RGBA", (im.width + 2 * pad, im.height + 2 * pad), (0, 0, 0, 0))
    sh.paste((0, 0, 0, alpha), (pad, pad, pad + im.width, pad + im.height), im)
    sh = sh.filter(ImageFilter.GaussianBlur(blur))
    canvas.alpha_composite(sh, (pos[0] - pad, pos[1] - pad + dy))
    canvas.alpha_composite(im, pos)


def clipped(card, layer, mask):
    """Composite a layer onto the card, clipped to the card's rounded outline."""
    card.paste(layer, (0, 0), Image.composite(mask, Image.new("L", mask.size, 0), layer.split()[3]))


def sample_card(w, h, seed):
    """An illustrated CR80 portrait card: blue header, photo silhouette, name lines, a QR-style block."""
    k = 2   # drawn at 2x for smooth edges, then downsampled
    cw, ch = w * k, h * k
    rad = int(cw * 0.06)
    card = Image.new("RGBA", (cw, ch), (0, 0, 0, 0))
    d = ImageDraw.Draw(card)
    d.rounded_rectangle((0, 0, cw - 1, ch - 1), radius=rad, fill=(255, 255, 255, 255))
    mask = Image.new("L", (cw, ch), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, cw - 1, ch - 1), radius=rad, fill=255)
    head = Image.new("RGBA", (cw, ch), (0, 0, 0, 0))
    hd = ImageDraw.Draw(head)
    hd.rectangle((0, 0, cw, ch * 0.24), fill=BRAND + (255,))
    hd.rectangle((0, ch * 0.24, cw, ch * 0.255), fill=BRAND_MID + (255,))
    clipped(card, head, mask)
    d.rounded_rectangle((cw * 0.10, ch * 0.08, cw * 0.62, ch * 0.115), radius=8, fill=(255, 255, 255, 255))
    d.rounded_rectangle((cw * 0.10, ch * 0.14, cw * 0.46, ch * 0.165), radius=8, fill=(191, 214, 238, 255))
    # photo box with a silhouette
    px0, py0, px1, py1 = cw * 0.25, ch * 0.30, cw * 0.75, ch * 0.66
    prad = int(cw * 0.03)
    d.rounded_rectangle((px0, py0, px1, py1), radius=prad, fill=TINT + (255,))
    cx, r = (px0 + px1) / 2, (px1 - px0) * 0.17
    cy = py0 + (py1 - py0) * 0.38
    body = Image.new("RGBA", (cw, ch), (0, 0, 0, 0))
    bd = ImageDraw.Draw(body)
    bd.ellipse((cx - r, cy - r, cx + r, cy + r), fill=SILHOUETTE + (255,))
    bd.rounded_rectangle((cx - r * 1.9, cy + r * 1.45, cx + r * 1.9, py1 + r), radius=int(r * 1.1), fill=SILHOUETTE + (255,))
    pm = Image.new("L", (cw, ch), 0)
    ImageDraw.Draw(pm).rounded_rectangle((px0, py0, px1, py1), radius=prad, fill=255)
    clipped(card, body, pm)
    d.rounded_rectangle((px0, py0, px1, py1), radius=prad, outline=BRAND + (255,), width=int(cw * 0.012))
    # name and position lines
    d.rounded_rectangle((cw * 0.18, ch * 0.715, cw * 0.82, ch * 0.75), radius=8, fill=BRAND_DEEP + (255,))
    d.rounded_rectangle((cw * 0.26, ch * 0.775, cw * 0.74, ch * 0.80), radius=8, fill=INK_2 + (255,))
    # footer band with a staff number line and a QR-style block
    foot = Image.new("RGBA", (cw, ch), (0, 0, 0, 0))
    ImageDraw.Draw(foot).rectangle((0, ch * 0.87, cw, ch), fill=TINT + (255,))
    clipped(card, foot, mask)
    d.rounded_rectangle((cw * 0.08, ch * 0.92, cw * 0.42, ch * 0.945), radius=6, fill=BRAND + (255,))
    qx, qy, qs = cw * 0.76, ch * 0.885, cw * 0.16
    cell = qs / 9
    rnd = random.Random(seed)
    for i in range(9):
        for j in range(9):
            finder = (i < 3 and j < 3) or (i < 3 and j > 5) or (i > 5 and j < 3)
            on = (i % 2 == 0 or j % 2 == 0) if finder else rnd.random() < 0.45
            if on:
                d.rectangle((qx + j * cell, qy + i * cell, qx + (j + 1) * cell - 2, qy + (i + 1) * cell - 2), fill=INK + (255,))
    return card.resize((w, h), Image.LANCZOS)


def main():
    im = background()
    mark = Image.open(MARK).convert("RGBA").resize((176, 176), Image.LANCZOS)
    shadowed(mark, im, (150, 150), blur=18, alpha=120, dy=10)
    d = ImageDraw.Draw(im)
    x = 366
    title = font("manrope-latin-800", 104)
    d.text((x, 150), "ID Card Printing Software", font=title, fill=(255, 255, 255, 255))
    tw = d.textlength("ID Card Printing Software", font=title)
    tag = font("manrope-latin-800", 40)
    tx, ty = x + tw + 36, 150 + 40
    d.rounded_rectangle((tx, ty, tx + 150, ty + 66), radius=16, fill=(255, 255, 255, 255))
    d.text((tx + 75, ty + 33), "FREE", font=tag, fill=BRAND + (255,), anchor="mm")
    tagline = font("manrope-latin-500", 46)
    d.text((x, 308), "Design and print photo ID cards on your card printer.", font=tagline, fill=TINT + (255,))
    d.text((x, 376), "Free for Windows 10 and 11. Everything stays on your PC.", font=tagline, fill=(0xBF, 0xD6, 0xEE, 255))
    # translucent feature pills: drawn on their own layer so the alpha blends over the gradient
    small = font("manrope-latin-600", 34)
    pills = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    pd = ImageDraw.Draw(pills)
    y = 560
    for label in ["Template builder", "Clients & people", "CSV import", "Print queue", "Encrypted backups"]:
        wlab = pd.textlength(label, font=small)
        pd.rounded_rectangle((x, y, x + wlab + 56, y + 70), radius=35, fill=(255, 255, 255, 36), outline=(255, 255, 255, 90), width=2)
        pd.text((x + 28, y + 35), label, font=small, fill=(255, 255, 255, 255), anchor="lm")
        x += wlab + 56 + 22
    im.alpha_composite(pills)
    d = ImageDraw.Draw(im)
    cw, ch = 300, 476
    c1 = sample_card(cw, ch, 7).rotate(-8, resample=Image.BICUBIC, expand=True)
    c2 = sample_card(cw, ch, 11).rotate(6, resample=Image.BICUBIC, expand=True)
    shadowed(c2, im, (1930, 140), blur=26, alpha=120, dy=24)
    shadowed(c1, im, (2150, 170), blur=26, alpha=130, dy=24)
    out = HERE / "banner.png"
    im.save(out, optimize=True)
    assert Image.open(out).size == (W, H), out
    print(out.name, f"{W}x{H}", f"{out.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
