"""
Generate bookt.ico — the desktop icon matching the wordmark:
a cream serif italic "T" with the terracotta dot on the warm dark background.

Usage: python scripts/make_icon.py
Outputs: bookt.ico (project root) + bookt-icon-preview.png (for inspection)
"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
FONT = r"C:\Windows\Fonts\georgiai.ttf"  # Georgia Italic ~ Fraunces italic vibe

# Quiet Paper dark-theme tokens (globals.css)
BG = (25, 22, 17, 255)        # --bg-primary  #191611
INK = (236, 229, 216, 255)    # --text-primary #ece5d8
ACCENT = (217, 138, 94, 255)  # --accent (dark) #d98a5e

SIZE = 512


def main():
    img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Rounded dark tile
    radius = 104
    draw.rounded_rectangle((0, 0, SIZE - 1, SIZE - 1), radius=radius, fill=BG)

    # Measure the T
    font = ImageFont.truetype(FONT, 400)
    x0, y0, x1, y1 = draw.textbbox((0, 0), "T", font=font)
    t_w, t_h = x1 - x0, y1 - y0

    dot_d = 88
    gap = 26
    total_w = t_w + gap + dot_d

    left = (SIZE - total_w) / 2
    top = (SIZE - t_h) / 2
    baseline = top + t_h  # "T" has no descender, its bottom is the baseline

    # T
    draw.text((left - x0, top - y0), "T", font=font, fill=INK)

    # Terracotta dot sitting on the baseline, after the T (like the wordmark)
    dot_x = left + t_w + gap
    draw.ellipse((dot_x, baseline - dot_d, dot_x + dot_d, baseline), fill=ACCENT)

    # Preview for inspection
    preview = img.resize((256, 256), Image.LANCZOS)
    preview.save(ROOT / "bookt-icon-preview.png")

    # Multi-size .ico
    base = img.resize((256, 256), Image.LANCZOS)
    base.save(
        ROOT / "bookt.ico",
        sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )
    print(f"wrote {ROOT / 'bookt.ico'} and bookt-icon-preview.png")


if __name__ == "__main__":
    main()
