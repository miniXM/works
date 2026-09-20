# -*- coding: utf-8 -*-
"""把 base app.asar 里所有 .css 抽到一个目录，方便 grep 原版样式。

用法：python dump-asar-css.py <输出目录>
"""

import json
import pathlib
import struct
import sys

HERE = pathlib.Path(__file__).resolve().parent
BASE = HERE / "base" / "app.asar"


def walk(node, prefix=""):
    for name, entry in node.get("files", {}).items():
        path = (prefix + "/" + name) if prefix else name
        if "files" in entry:
            yield from walk(entry, path)
        else:
            yield path, entry


def main(argv):
    out = pathlib.Path(argv[1]).resolve()
    out.mkdir(parents=True, exist_ok=True)
    raw = BASE.read_bytes()
    _outer, buffer_size, _payload, string_size = struct.unpack_from("<IIII", raw, 0)
    content_start = 8 + buffer_size
    header, _ = json.JSONDecoder().raw_decode(
        raw[16:16 + string_size].decode("utf-8"))
    count = 0
    for path, entry in walk(header):
        if not path.lower().endswith(".css"):
            continue
        start = content_start + int(entry["offset"])
        blob = raw[start:start + int(entry["size"])]
        target = out / pathlib.PurePosixPath(path).name
        target.write_bytes(blob)
        count += 1
        print("  %-46s %8d 字节" % (path, len(blob)))
    print("共 %d 个 css" % count)
    return 0


if __name__ == "__main__":
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(errors="replace")
        except Exception:
            pass
    raise SystemExit(main(sys.argv))
