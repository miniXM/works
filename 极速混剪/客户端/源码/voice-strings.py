# -*- coding: utf-8 -*-
# 把 voice_rules.py 里的关键串以 JSON 打出来，给 verify-brand.ps1 核对用。

import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import voice_rules  # noqa: E402


def main():
    payload = {
        "DROPDOWN_OLD": voice_rules.DROPDOWN_OLD,
        "DROPDOWN_NEW": voice_rules.DROPDOWN_NEW,
        "WATCHER_OLD": voice_rules.WATCHER_OLD,
        "WATCHER_NEW": voice_rules.WATCHER_NEW,
        "HINT_OLD": voice_rules.HINT_OLD,
        "HINT_NEW": voice_rules.HINT_NEW,
        "HINT_TEXT": voice_rules.HINT_TEXT,
        "CONFIRM_OLD": voice_rules.CONFIRM_OLD,
        "CONFIRM_NEW": voice_rules.CONFIRM_NEW,
        "CONFIRM_TEXT": voice_rules.CONFIRM_TEXT,
        "FALLBACK_JS": voice_rules._FALLBACK_JS,
        "VOICE_COUNT": len(voice_rules.VOICE_LIST),
        # 旧的占位（写死「选择音色」）和旧的“灰掉不给点”都不该留下。
        "PLACEHOLDER_OLD": (
            "clearable:``,placeholder:`选择音色`,style:{width:`260px`},"
            "onVisibleChange:qe}"
        ),
        "DISABLED_OLD": "disabled:!Oe.value",
        "HINT_TEXT_OLD": "未填写 MiniMax Key，音色不可选（点这里去系统设置填）",
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
