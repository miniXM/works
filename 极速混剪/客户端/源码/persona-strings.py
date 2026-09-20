# -*- coding: utf-8 -*-
# 把 persona_rules.py 里的关键串以 JSON 打出来，给 verify-brand.ps1 核对用。

import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import persona_rules  # noqa: E402
import persona_seed_rules  # noqa: E402


def main():
    payload = {
        "IMPORT_NEW": persona_rules.IMPORT_NEW,
        "BTN_NEW": persona_rules.BTN_NEW,
        "PROMPT_FN": "function VmxAiPrompt(e,t){",
        "COVER": 'data-role="cover"',
        "SEED_NEW": persona_seed_rules.SEED_NEW,
        "SEED_OLD": persona_seed_rules.SEED_OLD,
        "STOCK_MARK": persona_seed_rules.STOCK[0][1],
        "NO_AGE": "key:`birth`",
        "NO_GENDER": "key:`gender`",
        "REF_OLD": persona_seed_rules.REF_OLD,
        "NEW_PROFILE_HOOK": "setTimeout(VmxAiOpen,300)",
        "OLD_EXAMPLE": "大家都叫我红姐",
        "OLD_NAME_PH": persona_seed_rules.NAME_OLD,
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
