# -*- coding: utf-8 -*-
# 把 ui_rules.py 里的三条样式串以 JSON 打出来，给 verify-brand.ps1 核对用。
# 三条分别是：新的 logo 样式、新的滚动/布局样式、被替换掉的旧滚动样式。

import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import ui_rules  # noqa: E402


def main():
    payload = {
        "LOGO_NEW": ui_rules.LOGO_NEW,
        "LAYOUT_NEW": ui_rules.LAYOUT_NEW,
        "LAYOUT_OLD": ui_rules.LAYOUT_OLD,
    }
    sys.stdout.write(json.dumps(payload, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(errors="replace")
        except Exception:
            pass
    raise SystemExit(main())
