# -*- coding: utf-8 -*-
"""把客户给的 icon.png 变成客户端要用的整套图标素材，并出对比预览图。

产出（work\rebrand\assets\out）：
    transparent\  原样透明底（镂空处透出背景）
    filled\       镂空处补成白色（等于“白底上看到的样子”，任何背景都不变样）
    plate\        白色圆角底板 + 图标（深色任务栏上也看得清）
    white\        墨色换成白色（深色托盘/任务栏专用）
    每个目录里都是 app.ico(7 尺寸) / app-icon.png / tray-icon.png / favicon.* / mark.png
    preview-icons.png    各尺寸在浅色、深色、任务栏上的实际观感
    preview-sidebar.png  侧栏左上角那张横版 logo 的排法

用法：python make-icon-assets.py [--src E:\桌面\icon.png]
"""

import argparse
import base64
import io
import pathlib
import sys

from PIL import Image, ImageDraw, ImageFont

HERE = pathlib.Path(__file__).resolve().parent
ASSETS = HERE / "assets"
OUT = ASSETS / "out"
FONT_HEAVY = pathlib.Path(r"E:\GPT Codex\2026-09-15\new-chat\work\videomix-rebuild"
                          r"\stage\videomix\resources\fonts\AlibabaPuHuiTi-3-105-Heavy.ttf")
FONT_UI = pathlib.Path(r"C:\Windows\Fonts\msyh.ttc")
FONT_UI_BOLD = pathlib.Path(r"C:\Windows\Fonts\msyhbd.ttc")
ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]
INK = (14, 31, 99, 255)
NAME = "极速VideoMix"
NAME_EN = "JiSu VideoMix"


def font(path, size):
    try:
        return ImageFont.truetype(str(path), size)
    except OSError:
        return ImageFont.load_default()


def load_icon(src):
    """裁掉四周透明边，只留内容。"""
    image = Image.open(src).convert("RGBA")
    mask = image.getchannel("A").point(lambda value: 255 if value > 8 else 0)
    return image.crop(mask.getbbox())


def fit(image, size, fill):
    """等比缩放放进 size×size 画布，内容占画布 fill。"""
    box = image.copy()
    limit = int(round(size * fill))
    box.thumbnail((limit, limit), Image.LANCZOS)
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    canvas.paste(box, ((size - box.width) // 2, (size - box.height) // 2), box)
    return canvas


def fill_holes(icon, color=(255, 255, 255, 255)):
    """把透明镂空补成白色：白底上看是什么样，做成图标就是什么样。"""
    canvas = Image.new("RGBA", icon.size, color)
    canvas.alpha_composite(icon)
    return canvas


def on_plate(icon, size, radius=0.22, fill=0.62, plate=(255, 255, 255, 255)):
    """白色圆角底板 + 图标，深色任务栏上也清楚。"""
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(canvas)
    draw.rounded_rectangle([0, 0, size - 1, size - 1],
                           radius=int(size * radius), fill=plate)
    inner = fit(icon, int(round(size * fill / 0.92)), 0.92)
    canvas.alpha_composite(inner, ((size - inner.width) // 2, (size - inner.height) // 2))
    return canvas


def white_ink(icon):
    """保留形状，把深蓝换成白色（镂空处仍然透明）。"""
    out = icon.copy()
    pixels = out.load()
    for y in range(out.height):
        for x in range(out.width):
            r, g, b, a = pixels[x, y]
            if a:
                pixels[x, y] = (255, 255, 255, a)
    return out


def make_bundle(master, folder, wordmark_icon):
    """一个变体：全套尺寸 + favicon + 方形 mark + 横版 logo。"""
    folder.mkdir(parents=True, exist_ok=True)
    small = fit(master, 256, 0.92)
    for name in ("app-icon.png", "tray-icon.png", "favicon.png"):
        small.save(folder / name)
    fit(master, 256, 0.92).save(folder / "favicon.ico",
                                format="ICO", sizes=[(s, s) for s in ICO_SIZES])
    buffer = io.BytesIO()
    small.save(buffer, format="PNG")
    (folder / "favicon.svg").write_text(
        '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" '
        'viewBox="0 0 256 256"><image width="256" height="256" '
        'href="data:image/png;base64,%s"/></svg>'
        % base64.b64encode(buffer.getvalue()).decode("ascii"), encoding="utf-8")
    fit(master, 1997, 0.88).save(folder / "mark.png")
    fit(master, 1024, 0.94).save(folder / "master-1024.png")
    ico = fit(master, 256, 0.94)
    ico.save(folder / "app.ico", format="ICO", sizes=[(s, s) for s in ICO_SIZES])
    make_wordmark(wordmark_icon, folder / "wordmark-2754x1027.png")


def make_wordmark(icon, target, size=(2754, 1027)):
    """左侧图标 + 右侧两行名称（上中文名、下英文名）。"""
    width, height = size
    canvas = Image.new("RGBA", size, (0, 0, 0, 0))
    mark_box = int(height * 0.80)
    mark = fit(icon, mark_box, 1.0)
    left = int(height * 0.07)
    canvas.alpha_composite(mark, (left, (height - mark_box) // 2))
    text_left = left + mark_box + int(height * 0.13)
    text_right = width - int(height * 0.08)
    draw = ImageDraw.Draw(canvas)

    def center(text, box, color, path, max_size):
        x0, y0, x1, y1 = box
        low, high, best = 10, max_size, None
        while low <= high:
            mid = (low + high) // 2
            f = font(path, mid)
            l, t, r, b = draw.textbbox((0, 0), text, font=f)
            if (r - l) <= (x1 - x0) and (b - t) <= (y1 - y0):
                best = (f, l, t, r, b)
                low = mid + 1
            else:
                high = mid - 1
        f, l, t, r, b = best or (font(path, 10), 0, 0, 0, 0)
        draw.text((x0 + (x1 - x0 - (r - l)) // 2 - l, y0 + (y1 - y0 - (b - t)) // 2 - t),
                  text, font=f, fill=color)

    center(NAME, (text_left, int(height * 0.16), text_right, int(height * 0.62)),
           (26, 49, 86, 255), FONT_HEAVY, int(height * 0.5))
    center(NAME_EN, (text_left, int(height * 0.60), text_right, int(height * 0.85)),
           (110, 130, 165, 255), FONT_HEAVY, int(height * 0.26))
    canvas.save(target)


def preview_icons(variants, target):
    """各尺寸在浅色 / 深色 / 任务栏上的实际观感。"""
    sizes = [128, 64, 48, 32, 24, 16]
    row_h = 190
    width = 1180
    height = 130 + row_h * len(variants)
    sheet = Image.new("RGBA", (width, height), (247, 249, 252, 255))
    draw = ImageDraw.Draw(sheet)

    def heading(text, xy, size=26, color=(20, 30, 60, 255), path=FONT_UI_BOLD):
        draw.text(xy, text, font=font(path, size), fill=color)

    heading("icon.png 各尺寸实际观感（左：浅色背景　右：深色任务栏背景）", (24, 26))
    heading("图标本身是深蓝 #0E1F63，剪刀和条纹是镂空透明", (24, 66), 18, (90, 100, 120, 255))

    for index, (label, folder, master) in enumerate(variants):
        top = 120 + index * row_h
        heading(label, (24, top + 66), 22)
        light = [24, top + 10, 566, top + 170]
        dark = [590, top + 10, width - 24, top + 170]
        draw.rounded_rectangle(light, radius=14, fill=(255, 255, 255, 255),
                               outline=(214, 222, 236, 255))
        draw.rounded_rectangle(dark, radius=14, fill=(32, 33, 36, 255))
        for panel in (light, dark):
            x = panel[0] + 26
            for size in sizes:
                icon = fit(master, size, 0.92)
                y = top + 10 + (160 - size) // 2
                sheet.alpha_composite(icon, (x, y))
                draw.text((x + size // 2, top + 158), str(size), font=font(FONT_UI, 14),
                          fill=(120, 130, 150, 255), anchor="mb")
                x += size + 26

    sheet.convert("RGB").save(target, quality=95)


def preview_sidebar(wordmark, square, target):
    """侧栏左上角那张的真实尺寸预览（展开 68px 卡片 / 收起 56px 卡片）。"""
    sheet = Image.new("RGB", (1180, 420), (196, 205, 226))
    draw = ImageDraw.Draw(sheet)

    def card(box, radius=20, fill=(207, 217, 244, 128)):
        overlay = Image.new("RGBA", sheet.size, (0, 0, 0, 0))
        ImageDraw.Draw(overlay).rounded_rectangle(box, radius=radius, fill=fill)
        sheet.paste(Image.alpha_composite(sheet.convert("RGBA"), overlay).convert("RGB"), (0, 0))

    draw.text((30, 24), "展开状态：68px 高的卡片，里面是横版 logo（实际显示约 139 × 52 px）",
              font=font(FONT_UI_BOLD, 20), fill=(20, 30, 60))
    card([30, 60, 247, 128])
    wide = wordmark.copy()
    wide.thumbnail((205, 52), Image.LANCZOS)
    sheet.paste(wide, (30 + (217 - wide.width) // 2, 60 + (68 - wide.height) // 2), wide)

    draw.text((300, 24), "收起状态：56px 卡片，里面是方形 mark",
              font=font(FONT_UI_BOLD, 20), fill=(20, 30, 60))
    card([300, 66, 356, 122], radius=18)
    small = square.copy()
    small.thumbnail((46, 46), Image.LANCZOS)
    sheet.paste(small, (300 + (56 - small.width) // 2, 66 + (56 - small.height) // 2), small)

    draw.text((420, 24), "深色任务栏上的样子（桌面 / 托盘）",
              font=font(FONT_UI_BOLD, 20), fill=(20, 30, 60))
    draw.rounded_rectangle([420, 66, 1150, 122], radius=8, fill=(32, 33, 36))
    x = 450
    for size in (32, 24, 20, 16):
        icon = fit(square, size, 0.92)
        sheet.paste(icon, (x, 66 + (56 - size) // 2), icon)
        x += size + 40

    draw.text((30, 170), "参考：现在安装包里用的是厂商那张（INNOVESSEL / AI 创舰学院）",
              font=font(FONT_UI_BOLD, 20), fill=(20, 30, 60))
    old = Image.open(pathlib.Path(r"E:\GPT Codex\2026-09-15\new-chat\work\videomix-rebuild"
                                  r"\asar\dist\assets\创舰1-bJwsFj2F.png")).convert("RGBA")
    old.thumbnail((205, 52), Image.LANCZOS)
    card([30, 206, 247, 274])
    sheet.paste(old, (30 + (217 - old.width) // 2, 206 + (68 - old.height) // 2), old)
    card([300, 206, 356, 262], radius=18)
    old_sq = Image.open(pathlib.Path(r"E:\GPT Codex\2026-09-15\new-chat\work\videomix-rebuild"
                                     r"\asar\dist\assets\创舰-CaezdxB6.png")).convert("RGBA")
    old_sq.thumbnail((46, 46), Image.LANCZOS)
    sheet.paste(old_sq, (300 + (56 - old_sq.width) // 2, 206 + (56 - old_sq.height) // 2), old_sq)

    draw.text((30, 300), "新版横版 logo 单独放大看（2754 × 1027，与厂商那张同画布）",
              font=font(FONT_UI_BOLD, 20), fill=(20, 30, 60))
    zoom = wordmark.copy()
    zoom.thumbnail((700, 260), Image.LANCZOS)
    sheet.paste(zoom, (30, 336), zoom)
    sheet.save(target)


def main(argv=None):
    parser = argparse.ArgumentParser(description="生成图标素材与预览")
    parser.add_argument("--src", default=str(ASSETS / "icon-source.png"))
    parser.add_argument("--out", default=str(OUT))
    args = parser.parse_args(argv)

    out = pathlib.Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    icon = load_icon(pathlib.Path(args.src))
    print("源图裁掉透明边后：%d×%d（比例 %.3f）" % (icon.width, icon.height, icon.width / icon.height))

    filled = fill_holes(icon)
    variants = {
        "transparent": icon,
        "filled": filled,
        "plate": on_plate(icon, 1024),
        "white": white_ink(icon),
    }
    bundles = []
    for name, master in variants.items():
        folder = out / name
        make_bundle(master, folder, filled if name in ("transparent", "plate") else master)
        bundles.append((name, master))
        print("  已生成 %s（master 1024、app.ico 7 尺寸、wordmark 2754×1027）" % folder)

    labels = {
        "transparent": "① 原样透明底：镂空处透出背景，浅色皮肤下就是你现在看到的样子",
        "filled": "② 镂空补白：固定成白底上的样子，放哪都一样（推荐做图标）",
        "plate": "③ 白色圆角底板：深色任务栏/托盘上最清楚，但外面多一圈白底",
        "white": "④ 反白版：深蓝换白色，深色任务栏专用（也可以只用在托盘）",
    }
    preview_icons([(labels[name], out / name, master) for name, master in bundles],
                  out / "preview-icons.png")
    preview_sidebar(Image.open(out / "filled" / "wordmark-2754x1027.png"),
                    Image.open(out / "filled" / "mark.png"),
                    out / "preview-sidebar.png")
    print("预览图：%s" % (out / "preview-icons.png"))
    print("预览图：%s" % (out / "preview-sidebar.png"))
    return 0


if __name__ == "__main__":
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(errors="replace")
        except Exception:
            pass
    sys.exit(main())
