# -*- coding: utf-8 -*-
"""Prepare the app-icon source variants from the supplied icon.png."""

import pathlib
import sys

from PIL import Image

HERE = pathlib.Path(__file__).resolve().parent
ASSETS = HERE / "assets"
SRC = ASSETS / "icon-source.png"


def load_icon(src):
    image = Image.open(src).convert("RGBA")
    mask = image.getchannel("A").point(lambda value: 255 if value > 8 else 0)
    return image.crop(mask.getbbox())


def fill_holes(icon, color=(255, 255, 255, 255)):
    canvas = Image.new("RGBA", icon.size, color)
    canvas.alpha_composite(icon)
    return canvas


def main():
    icon = load_icon(SRC)
    print("icon source %d x %d" % icon.size)
    filled = fill_holes(icon)
    filled.save(ASSETS / "logo-filled.png")
    print("wrote %s" % (ASSETS / "logo-filled.png"))
    return 0


if __name__ == "__main__":
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(errors="replace")
        except Exception:
            pass
    raise SystemExit(main())
