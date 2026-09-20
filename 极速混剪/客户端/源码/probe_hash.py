# -*- coding: utf-8 -*-
"""找出 Electron 到底是“对什么”算 asar 的 SHA256。

已知：
    基线 exe 里写的是 c6236f8bde732e301a6fcbd0d026633552b300097d58600d0fbc835da43742f3，
    基线 asar 的“整文件 SHA256”是 57e9a9e41c9a90f5eb4273f5e5dd947d795b43141e989b1bd941a2e62241f9c5，
    两者不等，可基线客户端跑得起来 —— 说明校验没失败，即 Electron 算出来的就是 c6236f8b…
    于是把它当成“函数 f(asar) = exe 里那个值”来反推 f。
"""

import hashlib
import json
import pathlib
import struct
import sys

BASE_ASAR = r"E:\GPT Codex\2026-09-15\new-chat\work\rebrand\base\app.asar"
BASE_HASH = "c6236f8bde732e301a6fcbd0d026633552b300097d58600d0fbc835da43742f3"
NEW_ASAR = r"E:\GPT Codex\2026-09-15\new-chat\work\rebrand\build\out\app.asar"
NEW_EXPECT = "0d2dd4d59fcf409704584b25bcf0077ede3617c29baca62de9478a1e3755d201"


def variants(data):
    outer, buffer_size, payload_size, string_size = struct.unpack_from("<IIII", data, 0)
    content_start = 8 + buffer_size
    header, _ = json.JSONDecoder().raw_decode(data[16:16 + string_size].decode("utf-8"))
    yield "whole file", data
    yield "skip 4", data[4:]
    yield "skip 8", data[8:]
    yield "skip 16", data[16:]
    yield "skip 8+header", data[content_start:]
    yield "content only", data[content_start:]
    yield "header buffer", data[8:content_start]
    yield "json", data[16:16 + string_size]
    yield "json+pad", data[16:8 + buffer_size]
    yield "first 8", data[:8]
    yield "trim 8", data[:len(data) - 8]
    yield "trim 4", data[:len(data) - 4]
    # 条目内容按顺序拼接
    blobs = []
    stack = [header]
    while stack:
        node = stack.pop()
        for name, entry in node.get("files", {}).items():
            if "files" in entry:
                stack.append(entry)
            elif "offset" in entry:
                start = content_start + int(entry["offset"])
                blobs.append(data[start:start + int(entry["size"])])
    yield "all entry contents", b"".join(blobs)


def main():
    base = pathlib.Path(BASE_ASAR).read_bytes()
    fresh = pathlib.Path(NEW_ASAR).read_bytes()
    found = None
    for label, blob in variants(base):
        digest = hashlib.sha256(blob).hexdigest()
        mark = "  <<== 命中" if digest == BASE_HASH else ""
        print("  %-20s %s%s" % (label, digest, mark))
        if digest == BASE_HASH:
            found = label
    print("")
    if not found:
        print("没有候选变换能对上基线 exe 里的值 —— 说明它不是这么算出来的")
        return 1
    print("命中：%s，现在看它对新的 asar 算出来是不是 %s" % (found, NEW_EXPECT[:16]))
    for label, blob in variants(fresh):
        if label != found:
            continue
        digest = hashlib.sha256(blob).hexdigest()
        print("  %s -> %s  %s" % (label, digest, "对上了" if digest == NEW_EXPECT else "对不上"))
    return 0


if __name__ == "__main__":
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(errors="replace")
        except Exception:
            pass
    sys.exit(main())
