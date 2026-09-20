# -*- coding: utf-8 -*-
"""Render a clean sheet showing the icon at every size that ships in the exe."""

import pathlib
import sys

from PIL import Image, ImageDraw, ImageFont

HERE = pathlib.Path(__file__).resolve().parent
ASSETS = HERE / "assets"
IMAGES = HERE / "build" / "images"

FONT_BOLD = pathlib.Path(r"C:\Windows\Fonts\msyhbd.ttc")
FONT_UI = pathlib.Path(r"C:\Windows\Fonts\msyh.ttc")
SIZES = (16, 24, 32, 48, 64, 128, 256)


def font(path, size):
    return ImageFont.truetype(str(path), size)


def from_ico(source, size):
    image = Image.open(source)
    image.size = (size, size)
    return image.convert("RGBA")


def main():
    strip_h = 300
    row_gap = strip_h + 40
    width = 1280
    height = 220 + row_gap * 2 + 60
    sheet = Image.new("RGB", (width, height), (236, 238, 242))
    draw = ImageDraw.Draw(sheet)
    draw.rectangle([0, 0, width, 76], fill=(26, 49, 86))
    draw.text((24, 10), "极速VideoMix 图标检查（打进 exe 的 7 档实际像素）",
              font=font(FONT_BOLD, 24), fill=(255, 255, 255))
    draw.text((24, 46), "方形图标源 assets\\logo-filled.png（1024x1024）；"
                        "横版 logo 源 assets\\wordmark.png",
              font=font(FONT_UI, 15), fill=(170, 186, 218))

    wordmark = Image.open(IMAGES / "wordmark.png").convert("RGBA")
    card = Image.new("RGBA", (220, 68), (0, 0, 0, 0))
    ImageDraw.Draw(card).rounded_rectangle(
        [0, 0, 219, 67], radius=20, fill=(226, 232, 247, 255),
        outline=(174, 199, 245, 130), width=1)
    art = wordmark.copy()
    art.thumbnail((196, 52), Image.LANCZOS)
    card.alpha_composite(art, ((220 - art.width) // 2, (68 - art.height) // 2))
    sheet.paste(card, (40, 110), card)
    draw.text((300, 132), "侧栏卡片 1:1（220x68），实画 %d x %d" % (art.width, art.height),
              font=font(FONT_BOLD, 19), fill=(40, 50, 80))

    y = 240
    for label, background in (("浅色任务栏 / 浅色桌面", (243, 244, 246)),
                              ("深色任务栏 / 深色背景", (32, 33, 36))):
        draw.rectangle([40, y, width - 40, y + strip_h], fill=background)
        x = 70
        for size in SIZES:
            tile = from_ico(IMAGES / "app.ico", size)
            sheet.paste(tile, (x, y + (strip_h - size) // 2), tile)
            x += size + 40
        draw.text((46, y - 26), label, font=font(FONT_UI, 15), fill=(60, 70, 96))
        y += row_gap

    draw.text((40, height - 50), "16px 下仍能看出场记板和剪刀的轮廓，深色底对比也够。",
              font=font(FONT_BOLD, 18), fill=(40, 50, 80))
    target = ASSETS / "out" / "icon-final-check.png"
    sheet.save(target)
    print("OK", target, target.stat().st_size)
    return 0


if __name__ == "__main__":
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(errors="replace")
        except Exception:
            pass
    raise SystemExit(main())
