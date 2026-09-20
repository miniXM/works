# -*- coding: utf-8 -*-
"""把交付文档里的版本号从 1.1.2 统一改成 1.0.0，并换上新安装包的大小与哈希。"""
import pathlib
import sys

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

OUT = pathlib.Path(r"E:\GPT Codex\2026-09-15\new-chat\outputs\videomix-rebuild")
NEW_SIZE = "1,020,532,112"
NEW_SHA = "95c6d8ec2df12e9d191e54fc2f0e4a9239353062590f15d45747748e006a3212"
OLD_SIZE = "1,020,532,119"
OLD_SHA = "56b2a975f6f91e617de85cb74ef1a3f3ee25c27e7a04221cea4b75ff39744f29"

RULES = [
    ("1.1.2 → 1.1.3", "1.0.0 → 1.0.1"),
    ("1.1.3", "1.0.1"),
    ("1.1.2", "1.0.0"),
    (OLD_SIZE, NEW_SIZE),
    (OLD_SHA, NEW_SHA),
]

for name in ("README.md", "技术说明.md"):
    path = OUT / name
    text = path.read_text(encoding="utf-8")
    before = text
    for old, new in RULES:
        text = text.replace(old, new)
    if text != before:
        path.write_text(text, encoding="utf-8")
        print("已更新 %s" % path)
    else:
        print("无变化 %s" % path)

print("__RUN_END__")
