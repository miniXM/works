# -*- coding: utf-8 -*-
"""Render the final brand preview: real sidebar card plus icon variants.

Writes work/rebrand/assets/out/preview-sidebar.png
"""

import pathlib
import sys

from PIL import Image, ImageDraw, ImageFont

HERE = pathlib.Path(__file__).resolve().parent
ASSETS = HERE / "assets"
OUT = ASSETS / "out"
VENDOR = pathlib.Path(
    r"E:\GPT Codex\2026-09-15\new-chat\work\rebrand\base-asardist")

FONT_UI = pathlib.Path(r"C:\Windows\Fonts\msyh.ttc")
FONT_UI_BOLD = pathlib.Path(r"C:\Windows\Fonts\msyhbd.ttc")

INK = (14, 31, 99, 255)
CARD_COLOR = (226, 232, 247)   # measured from the shipped client: #E2E8F7
PAGE_COLOR = (245, 246, 250)

CARD_W, CARD_H = 220, 68
IMG_W, IMG_H = 196, 52
COLLAPSED_W, COLLAPSED_H = 72, 68


def font(path, size):
    try:
        return ImageFont.truetype(str(path), int(size))
    except OSError:
        return ImageFont.load_default()


def load_icon(src):
    image = Image.open(src).convert("RGBA")
    mask = image.getchannel("A").point(lambda value: 255 if value > 8 else 0)
    return image.crop(mask.getbbox())


def fit_scale(image, w, h):
    scale = min(w / image.width, h / image.height)
    return image.resize((max(1, int(round(image.width * scale))),
                         max(1, int(round(image.height * scale)))), Image.LANCZOS)


def square(image, size, pad=0.0):
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    box = image.copy()
    box.thumbnail((int(size * (1 - 2 * pad)), int(size * (1 - 2 * pad))), Image.LANCZOS)
    canvas.paste(box, ((size - box.width) // 2, (size - box.height) // 2), box)
    return canvas


def fill_holes(icon, color=(255, 255, 255, 255)):
    canvas = Image.new("RGBA", icon.size, color)
    canvas.alpha_composite(icon)
    return canvas


def white_ink(icon):
    out = icon.copy()
    px = out.load()
    for y in range(out.height):
        for x in range(out.width):
            r, g, b, a = px[x, y]
            if a:
                px[x, y] = (255, 255, 255, a)
    return out


def on_plate(icon, size, radius=0.22, fill=0.62):
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    ImageDraw.Draw(canvas).rounded_rectangle(
        [0, 0, size - 1, size - 1], radius=int(size * radius),
        fill=(255, 255, 255, 255))
    side = int(round(size * fill))
    inner = square(icon, side)
    canvas.alpha_composite(inner, ((size - inner.width) // 2,
                                   (size - inner.height) // 2))
    return canvas


def logo_card(content, w=CARD_W, h=CARD_H, radius=20, max_w=IMG_W, max_h=IMG_H):
    card = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(card)
    draw.rounded_rectangle([0, 0, w - 1, h - 1], radius=radius,
                           fill=CARD_COLOR + (255,))
    draw.rounded_rectangle([0, 0, w - 1, h - 1], radius=radius,
                           outline=(174, 199, 245, 130), width=1)
    art = fit_scale(content, max_w, max_h)
    card.alpha_composite(art, ((w - art.width) // 2, (h - art.height) // 2))
    return card


def strip(sheet, x, y, w, h, sizes, icon, bg, gap=24, radius=6):
    sheet.alpha_composite(Image.new("RGBA", (w, h), bg + (255,)), (x, y))
    draw = ImageDraw.Draw(sheet)
    draw.rounded_rectangle([x, y, x + w - 1, y + h - 1], radius=radius,
                           outline=(0, 0, 0, 40), width=1)
    total = sum(sizes) + gap * (len(sizes) - 1)
    cx = x + (w - total) // 2
    for size in sizes:
        art = square(icon, size)
        sheet.alpha_composite(art, (cx, y + (h - size) // 2))
        cx += size + gap


def label(sheet, xy, text, size=16, bold=True, fill=(28, 38, 66)):
    ImageDraw.Draw(sheet).text(
        xy, text, font=font(FONT_UI_BOLD if bold else FONT_UI, size), fill=fill)


def main():
    icon = load_icon(ASSETS / "icon-source.png")
    filled = fill_holes(icon)
    plate = on_plate(icon, 1024)
    white = white_ink(icon)
    wordmark = Image.open(ASSETS / "wordmark.png").convert("RGBA")

    old_wordmark_path = VENDOR / "创舰1-bJwsFj2F.png"
    old_mark_path = VENDOR / "创舰-CaezdxB6.png"
    old_wordmark = Image.open(old_wordmark_path).convert("RGBA") if old_wordmark_path.exists() else None
    old_mark = Image.open(old_mark_path).convert("RGBA") if old_mark_path.exists() else None

    variants = [
        ("①  原样（镂空保持透明）", icon, "浅色底正常；深色任务栏上，剪刀环和斜杠缝会消失"),
        ("②  镂空补白（推荐）", filled, "内部镂空填成白色，深浅底色都不变形"),
        ("③  白色圆角底板", plate, "最醒目，像 Win11 磁贴；代价是四周多一圈白底"),
        ("④  反白版（深底专用）", white, "深色任务栏清楚，浅色底上几乎看不见"),
    ]

    width = 1280
    sec_a_y = 92
    sec_a_h = 430
    sec_b_y = sec_a_y + sec_a_h
    row_h = 108
    height = int(sec_b_y + 44 + row_h * len(variants) + 56)

    sheet = Image.new("RGBA", (width, height), (236, 238, 242, 255))
    draw = ImageDraw.Draw(sheet)
    draw.rectangle([0, 0, width, 74], fill=(26, 49, 86, 255))
    label(sheet, (30, 12), "极速VideoMix · 侧栏 logo 与图标效果预览", 25, True, (255, 255, 255))
    label(sheet, (30, 46), "素材：左边栏用 E:\\桌面\\zuojiao.png；程序图标用 E:\\桌面\\icon.png",
          14, False, (170, 186, 218))

    # ---------- section A ----------
    draw.rectangle([0, sec_a_y, width, sec_a_y + sec_a_h], fill=PAGE_COLOR + (255,))
    label(sheet, (30, sec_a_y + 14),
          "一、侧栏左上角 logo（按客户端真实尺寸 1:1 渲染，卡片底色实测 #E2E8F7）", 18)

    y = sec_a_y + 52
    label(sheet, (30, y), "新版（你用 zuojiao.png）", 14, False, (106, 116, 138))
    label(sheet, (290, y), "旧版（厂商 INNOVESSEL）", 14, False, (106, 116, 138))
    label(sheet, (550, y), "侧栏收起", 14, False, (106, 116, 138))
    y += 24
    sheet.alpha_composite(logo_card(wordmark), (30, y))
    if old_wordmark is not None:
        sheet.alpha_composite(logo_card(old_wordmark, max_w=196, max_h=52), (290, y))
    sheet.alpha_composite(
        logo_card(square(filled, 1997, 0.08), COLLAPSED_W, COLLAPSED_H, radius=18,
                  max_w=46, max_h=46), (550, y))
    if old_mark is not None:
        old_sq = fit_scale(old_mark, 46, 46)
        holder = Image.new("RGBA", (COLLAPSED_W, COLLAPSED_H), (0, 0, 0, 0))
        ImageDraw.Draw(holder).rounded_rectangle(
            [0, 0, COLLAPSED_W - 1, COLLAPSED_H - 1], radius=18, fill=CARD_COLOR + (255,))
        holder.alpha_composite(old_sq, ((COLLAPSED_W - old_sq.width) // 2,
                                        (COLLAPSED_H - old_sq.height) // 2))
        sheet.alpha_composite(holder, (660, y))
        label(sheet, (660, y + 72), "旧版收起", 12, False, (106, 116, 138))

    label(sheet, (790, y - 24), "新版放大", 14, False, (106, 116, 138))
    zoom = fit_scale(wordmark, 450, 137)
    sheet.alpha_composite(zoom, (790, y))

    y += 108
    label(sheet, (30, y + 52),
          "在客户端里，这张图会按“最大高 52px、最大宽 196px”等比放进卡片，实测渲染约 170×52。",
          14, False, (86, 96, 118))

    # ---------- section B ----------
    label(sheet, (30, sec_b_y + 12),
          "二、程序图标 / 任务栏 / 托盘 —— 同一张 icon.png 的四种处理（左浅色右深色）", 18)
    label(sheet, (380, sec_b_y + 40), "浅色任务栏  16 / 24 / 32 / 48 / 96", 13, False, (106, 116, 138))
    label(sheet, (830, sec_b_y + 40), "深色任务栏  16 / 24 / 32 / 48 / 96", 13, False, (106, 116, 138))

    y = sec_b_y + 62
    sizes = (16, 24, 32, 48, 96)
    for name, master, note in variants:
        label(sheet, (30, y + 22), name, 16)
        label(sheet, (30, y + 48), note, 13, False, (108, 118, 140))
        strip(sheet, 380, y, 430, 100, sizes, master, (243, 244, 246))
        strip(sheet, 830, y, 430, 100, sizes, master, (32, 33, 36))
        y += row_h

    label(sheet, (30, height - 44),
          "建议选 ②：侧栏 logo 用你给的 zuojiao.png，程序图标用 ② 后在任何底色上都清楚。", 16)

    target = OUT / "preview-sidebar.png"
    sheet.convert("RGB").save(target)
    print("OK", target, target.stat().st_size)
    return 0


if __name__ == "__main__":
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(errors="replace")
        except Exception:
            pass
    raise SystemExit(main())
