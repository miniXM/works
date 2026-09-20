# -*- coding: utf-8 -*-
"""Dump one file out of the pristine base app.asar for inspection/patching."""

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


def read(asar, wanted):
    raw = asar.read_bytes()
    outer, buffer_size, payload_size, string_size = struct.unpack_from("<IIII", raw, 0)
    content_start = 8 + buffer_size
    header, _ = json.JSONDecoder().raw_decode(raw[16:16 + string_size].decode("utf-8"))
    for path, entry in walk(header):
        if path == wanted:
            start = content_start + int(entry["offset"])
            return raw[start:start + int(entry["size"])]
    raise SystemExit("not found: " + wanted)


if __name__ == "__main__":
    if len(sys.argv) < 3:
        raise SystemExit("usage: dump-asar-file.py <entry-path> <out-file> [asar]")
    asar = pathlib.Path(sys.argv[3]) if len(sys.argv) > 3 else BASE
    blob = read(asar, sys.argv[1])
    pathlib.Path(sys.argv[2]).write_bytes(blob)
    print("wrote %s (%d bytes)" % (sys.argv[2], len(blob)))
