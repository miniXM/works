# -*- coding: utf-8 -*-
"""在打包后的 js 里看某个串周围的代码：ctx.py <文件> <串> [窗口] [最多几处]"""

import pathlib
import re
import sys


def main(argv):
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(errors="replace", encoding="utf-8")
        except Exception:
            pass
    path = pathlib.Path(argv[1])
    needle = argv[2]
    window = int(argv[3]) if len(argv) > 3 else 500
    limit = int(argv[4]) if len(argv) > 4 else 3
    text = path.read_text("utf-8")
    hits = list(re.finditer(re.escape(needle), text))
    print("%s: %d 处" % (path.name, len(hits)))
    for match in hits[:limit]:
        print("=== @%d ===" % match.start())
        print(text[max(0, match.start() - window):match.start() + window])
        print()
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
