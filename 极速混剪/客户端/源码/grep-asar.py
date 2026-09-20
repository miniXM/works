# -*- coding: utf-8 -*-
"""Search text entries inside an app.asar and print context around each hit.

usage: grep-asar.py <needle> [<context-chars>] [<asar>]
"""

import json
import pathlib
import re
import struct
import sys

HERE = pathlib.Path(__file__).resolve().parent
BASE = HERE / "base" / "app.asar"
TEXT_EXT = {".js", ".mjs", ".cjs", ".ts", ".css", ".html", ".json", ".vue"}


def walk(node, prefix=""):
    for name, entry in node.get("files", {}).items():
        path = (prefix + "/" + name) if prefix else name
        if "files" in entry:
            yield from walk(entry, path)
        else:
            yield path, entry


def main(argv):
    needle = argv[1]
    window = int(argv[2]) if len(argv) > 2 else 260
    asar = pathlib.Path(argv[3]) if len(argv) > 3 else BASE
    raw = asar.read_bytes()
    outer, buffer_size, payload_size, string_size = struct.unpack_from("<IIII", raw, 0)
    content_start = 8 + buffer_size
    header, _ = json.JSONDecoder().raw_decode(raw[16:16 + string_size].decode("utf-8"))
    total = 0
    for path, entry in walk(header):
        if pathlib.PurePosixPath(path).suffix.lower() not in TEXT_EXT:
            continue
        start = content_start + int(entry["offset"])
        blob = raw[start:start + int(entry["size"])]
        if needle.encode("utf-8") not in blob:
            continue
        text = blob.decode("utf-8", "replace")
        for match in re.finditer(re.escape(needle), text):
            total += 1
            print("### %s @%d" % (path, match.start()))
            print(text[max(0, match.start() - window):match.end() + window].replace("\n", "\\n"))
            print()
    print("hits", total)
    return 0


if __name__ == "__main__":
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(errors="replace")
        except Exception:
            pass
    raise SystemExit(main(sys.argv))
