# -*- coding: utf-8 -*-
"""Pull the original vendor logo images out of the pristine app.asar."""

import json
import pathlib
import struct
import sys

HERE = pathlib.Path(__file__).resolve().parent
BASE = HERE / "base" / "app.asar"
TARGET = HERE / "base-asardist"
WANTED = {
    "dist/assets/创舰1-bJwsFj2F.png",
    "dist/assets/创舰-CaezdxB6.png",
}


def walk(node, prefix=""):
    for name, entry in node.get("files", {}).items():
        path = (prefix + "/" + name) if prefix else name
        if "files" in entry:
            yield from walk(entry, path)
        else:
            yield path, entry


def main():
    raw = BASE.read_bytes()
    outer, buffer_size, payload_size, string_size = struct.unpack_from("<IIII", raw, 0)
    content_start = 8 + buffer_size
    header, _ = json.JSONDecoder().raw_decode(raw[16:16 + string_size].decode("utf-8"))
    TARGET.mkdir(parents=True, exist_ok=True)
    found = 0
    for path, entry in walk(header):
        if path not in WANTED:
            continue
        start = content_start + int(entry["offset"])
        blob = raw[start:start + int(entry["size"])]
        out = TARGET / pathlib.PurePosixPath(path).name
        out.write_bytes(blob)
        print("extracted %s -> %s (%d bytes)" % (path, out.name, len(blob)))
        found += 1
    print("done, %d file(s)" % found)
    return 0 if found == len(WANTED) else 1


if __name__ == "__main__":
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(errors="replace")
        except Exception:
            pass
    raise SystemExit(main())
