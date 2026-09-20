# -*- coding: utf-8 -*-
"""撤销 2026-09-18 17:14 那次“把旧目录缺的文件补进新副本”的操作。

判定依据：这些文件在新目录里的创建时间 >= 17:10（补拷是 17:14 做的），
原来的 4073 个文件创建时间是 17:02~17:09。删完再清掉因此变空的目录。
"""
import pathlib
import shutil
import sys

from datetime import datetime

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

NEW = pathlib.Path(r"E:\GPT Codex\2026-09-18\Video Mix")
OLD = pathlib.Path(r"E:\GPT Codex\2026-09-15\new-chat")
CUT = datetime(2026, 9, 18, 17, 10, 0).timestamp()   # 补拷是 17:14 做的
DRY = "--dry" in sys.argv

EXPECTED_PARENT = pathlib.Path(r"E:\GPT Codex\2026-09-18")
if NEW.parent != EXPECTED_PARENT:
    raise SystemExit("目标目录不符合预期，停止：%s" % NEW)
if not NEW.is_dir():
    raise SystemExit("目标目录不存在：%s" % NEW)

removed = 0
freed = 0
dirs = set()

for path in sorted(NEW.rglob("*"), key=lambda p: len(p.parts), reverse=True):
    if path.is_file():
        if path.stat().st_ctime >= CUT:
            freed += path.stat().st_size
            removed += 1
            if DRY:
                continue
            path.unlink()
        continue
    if path.is_dir() and path != NEW:
        dirs.add(path)

if DRY:
    print("（dry-run，没有真的删）")

for d in sorted(dirs, key=lambda p: len(p.parts), reverse=True):
    if DRY:
        continue
    try:
        d.rmdir()
    except OSError:
        pass

print("已撤销：%d 个文件，%.1f MB" % (removed, freed / 1048576.0))
left = sum(1 for p in NEW.rglob("*") if p.is_file())
print("新目录剩余文件：%d 个" % left)
print("__RUN_END__")
