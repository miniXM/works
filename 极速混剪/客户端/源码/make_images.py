# -*- coding: utf-8 -*-
"""按品牌配置生成客户端要用的所有图标 / logo 图片。

产物（尺寸都对齐原版，替换后布局不会变）：
    app-icon.png / tray-icon.png / favicon.png   256×256
    mark.png                                     1997×1997   对应 创舰-CaezdxB6.png
    wordmark.png                                 2754×1027   对应 创舰1-bJwsFj2F.png
    app.ico                                      7 个尺寸（16/24/32/48/64/128/256）

用法：
    python make_images.py --config brand.json --out <输出目录> [--font <ttf>]
"""

import argparse
import json
import pathlib
import sys

from PIL import Image, ImageDraw, ImageFont

DEFAULT_FONT = (r"E:\GPT Codex\2026-09-15\new-chat\work\videomix-rebuild"
                r"\stage\videomix\resources\fonts\AlibabaPuHuiTi-3-105-Heavy.ttf")
ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]


def hex_color(text, fallback):
    text = (text or "").strip()
    if not text:
        return fallback
    text = text.lstrip("#")
    if len(text) == 3:
        text = "".join(ch * 2 for ch in text)
    try:
        return tuple(int(text[i:i + 2], 16) for i in (0, 2, 4)) + (255,)
    except ValueError:
        return fallback


def mix(a, b, ratio):
    return tuple(int(round(a[i] + (b[i] - a[i]) * ratio)) for i in range(4))


def load_logo(path):
    image = Image.open(path).convert("RGBA")
    return image


def fit_text(draw, text, font_path, box_width, box_height, max_size=1400, min_size=24):
    """挑一个刚好塞进给定框的字号，返回 (font, 宽, 高)。"""
    low, high, best = min_size, max_size, None
    while low <= high:
        size = (low + high) // 2
        font = ImageFont.truetype(font_path, size)
        left, top, right, bottom = draw.textbbox((0, 0), text, font=font)
        width, height = right - left, bottom - top
        if width <= box_width and height <= box_height:
            best = (font, width, height, left, top)
            low = size + 1
        else:
            high = size - 1
    if best is None:
        font = ImageFont.truetype(font_path, min_size)
        left, top, right, bottom = draw.textbbox((0, 0), text, font=font)
        best = (font, right - left, bottom - top, left, top)
    return best


def draw_text_center(draw, text, font_path, box, color, max_size=1400):
    """在 box=(x0,y0,x1,y1) 里居中写字。"""
    x0, y0, x1, y1 = box
    font, width, height, left, top = fit_text(
        draw, text, font_path, x1 - x0, y1 - y0, max_size=max_size)
    draw.text((x0 + (x1 - x0 - width) // 2 - left,
               y0 + (y1 - y0 - height) // 2 - top), text, font=font, fill=color)
    return width, height


def default_mark(name, theme, size):
    """没有 logo 时，用品牌名首字生成一枚圆角方块图标。"""
    image = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    radius = int(size * 0.22)
    gradient = Image.new("RGBA", (size, size))
    top = mix(theme, (255, 255, 255, 255), 0.32)
    bottom = mix(theme, (0, 0, 0, 255), 0.18)
    for y in range(size):
        ratio = y / max(1, size - 1)
        ImageDraw.Draw(gradient).line([(0, y), (size, y)], fill=mix(top, bottom, ratio))
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    image.paste(gradient, (0, 0), mask)
    text = name.strip()[:2] if name.strip() else "AI"
    draw = ImageDraw.Draw(image)
    draw_text_center(draw, text, DEFAULT_FONT,
                     (int(size * 0.12), int(size * 0.10), int(size * 0.88), int(size * 0.90)),
                     (255, 255, 255, 255), max_size=int(size * 0.62))
    return image


def square_icon(source, size, pad_ratio=0.0):
    """把来源图等比缩放放进 size×size 透明画布。"""
    inner = int(size * (1 - pad_ratio * 2))
    box = source.copy()
    box.thumbnail((inner, inner), Image.LANCZOS)
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    canvas.paste(box, ((size - box.width) // 2, (size - box.height) // 2), box)
    return canvas


def make_wordmark(mark, name, name_en, font_path, size):
    """横版 logo：左边图形，右边中英文名称。"""
    width, height = size
    canvas = Image.new("RGBA", size, (0, 0, 0, 0))
    mark_box = int(height * 0.82)
    logo = square_icon(mark, mark_box)
    canvas.paste(logo, (int(height * 0.09), (height - mark_box) // 2), logo)
    text_left = int(height * 0.09) + mark_box + int(height * 0.16)
    text_right = width - int(height * 0.12)
    if name_en:
        draw = ImageDraw.Draw(canvas)
        draw_text_center(draw, name, font_path,
                         (text_left, int(height * 0.16), text_right, int(height * 0.60)),
                         (26, 49, 86, 255), max_size=int(height * 0.44))
        draw_text_center(draw, name_en, font_path,
                         (text_left, int(height * 0.60), text_right, int(height * 0.84)),
                         (110, 130, 165, 255), max_size=int(height * 0.26))
    else:
        draw = ImageDraw.Draw(canvas)
        draw_text_center(draw, name, font_path,
                         (text_left, int(height * 0.16), text_right, int(height * 0.84)),
                         (26, 49, 86, 255), max_size=int(height * 0.5))
    return canvas


def main(argv=None):
    parser = argparse.ArgumentParser(description="生成客户端品牌图片")
    parser.add_argument("--config", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--font", default=DEFAULT_FONT)
    args = parser.parse_args(argv)

    config = json.loads(pathlib.Path(args.config).read_text(encoding="utf-8"))
    name = config["name"]
    name_en = config.get("nameEn", "")
    theme = hex_color(config.get("themeColor"), (47, 107, 255, 255))
    out = pathlib.Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    logo_path = config.get("logo") or ""
    if logo_path:
        source = load_logo(logo_path)
        print("  使用提供的 logo：%s（%d×%d）" % (logo_path, source.width, source.height))
    else:
        source = default_mark(name, theme, 1024)
        print("  没有提供 logo，用品牌名首字生成默认图标")

    small = square_icon(source, 256)
    for target in ("app-icon.png", "tray-icon.png", "favicon.png"):
        small.save(out / target)
    # favicon.svg：直接把 PNG 内嵌进去，任何浏览器/Electron 都能正常显示
    import base64
    import io
    buffer = io.BytesIO()
    small.save(buffer, format="PNG")
    encoded = base64.b64encode(buffer.getvalue()).decode("ascii")
    (out / "favicon.svg").write_text(
        '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" '
        'viewBox="0 0 256 256"><image width="256" height="256" '
        'href="data:image/png;base64,%s"/></svg>' % encoded, encoding="utf-8")
    mark = square_icon(source, 1997, pad_ratio=0.10)
    mark.save(out / "mark.png")

    wordmark_path = config.get("wordmark") or ""
    if wordmark_path:
        wordmark = Image.open(wordmark_path).convert("RGBA")
        # 裁掉四周空白后按高度等比缩放：客户端用 max-height/max-width 渲染，
        # 画布越大越空，logo 反而越小，所以这里必须保持真实宽高比。
        box = wordmark.getchannel("A").getbbox()
        if box:
            margin = max(2, int(round((box[3] - box[1]) * 0.02)))
            wordmark = wordmark.crop((
                max(0, box[0] - margin), max(0, box[1] - margin),
                min(wordmark.width, box[2] + margin),
                min(wordmark.height, box[3] + margin)))
        if wordmark.height != 1027:
            scale = 1027.0 / wordmark.height
            wordmark = wordmark.resize(
                (max(1, int(round(wordmark.width * scale))), 1027), Image.LANCZOS)
        print("  使用提供的横版 logo：%s（裁切后 %d×%d，宽高比 %.2f）"
              % (wordmark_path, wordmark.width, wordmark.height,
                 wordmark.width / wordmark.height))
    else:
        wordmark = make_wordmark(mark, name, name_en, args.font, (2754, 1027))
        print("  用字体生成横版 logo（%s / %s）" % (name, name_en or "无英文名"))
    wordmark.save(out / "wordmark.png")

    square_icon(source, 256, pad_ratio=0.06).save(
        out / "app.ico", format="ICO", sizes=[(size, size) for size in ICO_SIZES])
    print("  生成完毕：%s" % out)
    return 0


if __name__ == "__main__":
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(errors="replace")
        except Exception:
            pass
    sys.exit(main())
