# -*- coding: utf-8 -*-
"""把 probe\\ui 里最新的一套 final-*.png 归档到 outputs\\videomix-rebuild\\截图。

只动 outputs\\videomix-rebuild\\截图 这个目录，删掉的也只是本脚本上一次写的
32~49 号界面改版截图。
"""

import pathlib
import shutil
import sys

HERE = pathlib.Path(__file__).resolve().parent
SRC = HERE / "probe" / "ui"
DST = pathlib.Path(__file__).resolve().parents[2] / "outputs" / "videomix-rebuild" / "截图"

MAP = [
    ("final-激活页-暗黑.png", "32-界面改版-激活页-暗黑.png"),
    ("final-激活页-白天.png", "33-界面改版-激活页-白天.png"),
    ("final-工作台-暗黑.png", "34-界面改版-工作台-暗黑.png"),
    ("final-工作台-白天.png", "35-界面改版-工作台-白天.png"),
    ("final-账号档案-暗黑.png", "36-界面改版-账号档案-暗黑.png"),
    ("final-素材中心-暗黑.png", "37-界面改版-素材中心-暗黑.png"),
    ("final-镜头剪辑-暗黑.png", "38-界面改版-镜头剪辑-暗黑.png"),
    ("final-发布排期-白天.png", "39-界面改版-发布排期-白天.png"),
    ("final-系统设置-白天.png", "40-界面改版-系统设置-白天.png"),
    ("final-快速跳转菜单.png", "41-界面改版-快速跳转菜单.png"),
]

# 上一版（v2 皮肤）留下的同号截图，界面已经又改过，留着会误导
STALE = [
    "32-界面改版-激活页-暗黑.png",
    "33-界面改版-工作台-白天.png",
    "34-界面改版-工作台-暗黑.png",
    "35-界面改版-账号档案-暗黑.png",
    "36-界面改版-素材中心-暗黑.png",
    "37-界面改版-镜头剪辑-暗黑.png",
    "38-界面改版-系统设置-白天.png",
    "39-界面改版-真实启动器路径-激活页-白天.png",
]


def main():
    DST.mkdir(parents=True, exist_ok=True)
    for name in STALE:
        path = DST / name
        if path.is_file():
            path.unlink()
            print("  删除旧图 %s" % name)
    for source, target in MAP:
        src = SRC / source
        if not src.is_file():
            print("  跳过（源文件不存在）%s" % source)
            continue
        shutil.copyfile(src, DST / target)
        print("  归档 %s -> %s" % (source, target))
    return 0


if __name__ == "__main__":
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(errors="replace")
        except Exception:
            pass
    raise SystemExit(main())
