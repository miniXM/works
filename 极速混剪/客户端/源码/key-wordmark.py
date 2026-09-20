# -*- coding: utf-8 -*-
"""Turn the supplied flat-background wordmark into a transparent PNG.

Source : E:\桌面\zuojiao.png   (2754x1027, RGB, bg #E2E8F7, ink #0E1F63)
Output : work/rebrand/assets/wordmark.png   transparent, cropped, aspect kept
"""

import pathlib
import sys

from PIL import Image, ImageChops

HERE = pathlib.Path(__file__).resolve().parent
ASSETS = HERE / "assets"
SRC = pathlib.Path(r"E:\桌面\zuojiao.png")
OUT = ASSETS / "wordmark.png"

BG = (226, 232, 247)
INK = (14, 31, 99)
TARGET_HEIGHT = 1027
MARGIN = 0.02  # keep a hair of breathing room so glyph edges never clip


def clamp(value, low=0.0, high=1.0):
    return low if value < low else (high if value > high else value)


def keyed_alpha(rgb):
    """Per-pixel least-squares coverage of ink over background.

    Solves min over a in  sum_c (bg_c - a*span_c - pixel_c)^2, which is the
    most accurate way to recover alpha for a flat two-colour artwork.
    """
    spans = [BG[i] - INK[i] for i in range(3)]
    total = float(sum(span * span for span in spans))
    parts = []
    for index, channel in enumerate(rgb.split()):
        weight = spans[index] / total * 255.0
        lut = [int(round(clamp((BG[index] - value) * weight, 0.0, 255.0)))
               for value in range(256)]
        parts.append(channel.point(lut))
    return ImageChops.add(ImageChops.add(parts[0], parts[1]), parts[2])


def main():
    image = Image.open(SRC)
    print("source %s %s %s" % (image.mode, image.size, SRC.stat().st_size))
    rgb = image.convert("RGB")
    alpha = keyed_alpha(rgb)
    print("alpha extrema %s" % (alpha.getextrema(),))

    ink_layer = Image.new("RGBA", rgb.size, INK + (255,))
    ink_layer.putalpha(alpha)

    # round trip check: composite back onto the original background
    check = Image.new("RGB", rgb.size, BG)
    check.paste(ink_layer, (0, 0), ink_layer)
    diff = ImageChops.difference(check, rgb)
    print("round-trip max channel error %s" % (max(diff.getextrema(), key=lambda t: t[1]),))

    box = alpha.getbbox()
    print("content bbox %s  (%dx%d)" % (box, box[2] - box[0], box[3] - box[1]))

    pad_x = int(round((box[2] - box[0]) * MARGIN))
    pad_y = int(round((box[3] - box[1]) * MARGIN))
    left = max(0, box[0] - pad_x)
    top = max(0, box[1] - pad_y)
    right = min(rgb.width, box[2] + pad_x)
    bottom = min(rgb.height, box[3] + pad_y)
    cropped = ink_layer.crop((left, top, right, bottom))
    scale = TARGET_HEIGHT / cropped.height
    cropped = cropped.resize((int(round(cropped.width * scale)), TARGET_HEIGHT),
                             Image.LANCZOS)
    print("final %s  aspect %.2f" % (cropped.size, cropped.width / cropped.height))

    OUT.parent.mkdir(parents=True, exist_ok=True)
    cropped.save(OUT)
    print("wrote %s  %d bytes" % (OUT, OUT.stat().st_size))

    # how the app will actually paint it: max-height 52px, max-width 196px
    limit_w, limit_h = 196, 52
    fit = min(limit_w / cropped.width, limit_h / cropped.height)
    print("renders in the sidebar card at %d x %d css px"
          % (round(cropped.width * fit), round(cropped.height * fit)))
    return 0


if __name__ == "__main__":
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(errors="replace")
        except Exception:
            pass
    raise SystemExit(main())
