# -*- coding: utf-8 -*-
"""列出品牌字符串在 app.asar 解包目录里的每一处上下文，判断哪些能改、哪些不能改。

用法：
    python work\rebrand\scan_context.py [目录]
"""

import pathlib
import sys

ASAR_DIR = pathlib.Path(r"E:\GPT Codex\2026-09-15\new-chat\work\videomix-rebuild\asar")
PATTERNS = ["混剪矩阵智能体", "混剪矩阵", "INNOVESSEL", "AI 创舰学院", "创舰", "VideoMix", "videomix"]
TEXT_EXT = {".js", ".mjs", ".cjs", ".ts", ".css", ".html", ".json", ".yml", ".yaml", ".txt", ".svg", ".vue"}
PAD = 60


def main(root=ASAR_DIR):
    root = pathlib.Path(root)
    for path in sorted(root.rglob("*")):
        if not path.is_file() or path.suffix.lower() not in TEXT_EXT:
            continue
        rel = str(path.relative_to(root)).replace("\\", "/")
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        for pattern in PATTERNS:
            start = 0
            while True:
                pos = text.find(pattern, start)
                if pos < 0:
                    break
                left = max(0, pos - PAD)
                right = min(len(text), pos + len(pattern) + PAD)
                snippet = text[left:right].replace("\r", " ").replace("\n", " ")
                print("{0}  [{1}]  ...{2}...".format(rel, pattern, snippet))
                start = pos + 1
    return 0


if __name__ == "__main__":
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(errors="replace")
        except Exception:
            pass
    sys.exit(main(*(sys.argv[1:2] or [])))
