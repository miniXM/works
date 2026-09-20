# -*- coding: utf-8 -*-
"""把旧目录里“新目录还没有”的文件补到新工作副本里。

默认只补缺、不覆盖：新副本里的脚本已经把根路径改成新目录，覆盖会破坏它。
顺带列出“两边都有但内容不一样”的文件，交给人工判断。
"""
import pathlib
import shutil
import sys

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

SRC = pathlib.Path(r"E:\GPT Codex\2026-09-15\new-chat")
DST = pathlib.Path(r"E:\GPT Codex\2026-09-18\Video Mix")
SKIP_DIRS = {"__pycache__"}
DRY = "--dry" in sys.argv

copied = 0
copied_bytes = 0
differ = []
missing_by_dir = {}

for src in SRC.rglob("*"):
    if not src.is_file():
        continue
    rel = src.relative_to(SRC)
    if any(part in SKIP_DIRS for part in rel.parts):
        continue
    dst = DST / rel
    if dst.exists():
        if dst.stat().st_size != src.stat().st_size:
            differ.append((rel, src.stat().st_size, dst.stat().st_size))
        continue
    key = rel.parts[0] if len(rel.parts) == 1 else "/".join(rel.parts[:3])
    entry = missing_by_dir.setdefault(key, [0, 0])
    entry[0] += 1
    entry[1] += src.stat().st_size
    if DRY:
        copied += 1
        copied_bytes += src.stat().st_size
        continue
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dst)
    copied += 1
    copied_bytes += src.stat().st_size
    if copied % 200 == 0:
        print("  ...已补 %d 个（%.1f MB）" % (copied, copied_bytes / 1048576.0), flush=True)

print("补缺完成：%d 个文件，%.1f MB" % (copied, copied_bytes / 1048576.0))
print("按目录汇总：")
for key in sorted(missing_by_dir):
    n, b = missing_by_dir[key]
    print("   %-42s %5d 个  %9.1f MB" % (key, n, b / 1048576.0))
print("两边都有但大小不同的文件：%d 个" % len(differ))
for rel, a, b in differ[:80]:
    print("   %s  旧=%d  新=%d" % (rel, a, b))
print("__RUN_END__")
