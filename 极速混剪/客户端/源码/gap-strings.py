# -*- coding: utf-8 -*-
# 把 gap_rules.py 里的关键串以 JSON 打出来，给 verify-brand.ps1 核对用。

import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import gap_rules  # noqa: E402


def main():
    payload = {
        "IMPORT_NEW": gap_rules.IMPORT_NEW,
        "BT_NEW": gap_rules.BT_NEW,
        "ELSE_NEW": gap_rules.ELSE_NEW,
        "ELSE_OLD": gap_rules.ELSE_OLD,
        "GAP_LIMIT": gap_rules.GAP_LIMIT,
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
