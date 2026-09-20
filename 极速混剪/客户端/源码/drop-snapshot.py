# -*- coding: utf-8 -*-
"""删掉一个拍错的界面快照。只允许删 ui-versions 目录下的子目录。

用法：python drop-snapshot.py <快照目录名>
"""

import pathlib
import shutil
import sys

HERE = pathlib.Path(__file__).resolve().parent
ROOT = (HERE / "ui-versions").resolve()


def main(argv):
    if len(argv) < 2:
        print(__doc__)
        return 2
    target = (ROOT / argv[1]).resolve()
    if target.parent != ROOT or not target.is_dir():
        print("拒绝：%s 不是 %s 下的快照目录" % (target, ROOT))
        return 1
    shutil.rmtree(target)
    print("已删除 %s" % target)
    return 0


if __name__ == "__main__":
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(errors="replace")
        except Exception:
            pass
    raise SystemExit(main(sys.argv))
