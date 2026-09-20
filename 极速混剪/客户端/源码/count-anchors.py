# -*- coding: utf-8 -*-
"""Count candidate patch anchors inside the base app.asar (same walk as build_asar)."""

import json
import pathlib
import struct
import sys

HERE = pathlib.Path(__file__).resolve().parent
BASE = HERE / "base" / "app.asar"
TEXT_EXT = {".js", ".mjs", ".cjs", ".ts", ".css", ".html", ".json", ".yml",
            ".yaml", ".txt", ".svg", ".vue"}

ANCHORS = [
    "function $(e=`默认人设`,t){let n=Date.now();return{id:de(),name:String(e||``).trim()||`默认人设`,profile:Q(t),createdAt:n,updatedAt:n}}",
    "e.profile=Q({}),e.updatedAt=Date.now()",
    "function z(e){let t=Q(e),n=[],r=(e,t)=>{let r=String(t||``).trim();r&&n.push(`${e}：${r}`)};",
    "function $(e){return Object.values(e).filter(e=>String(e||``).trim()).length}",
    "鸭血粉丝汤",
    "红姐",
    "南京",
    "]},null,8,[`modelValue`",
]


def walk(node, prefix=""):
    for name, entry in node.get("files", {}).items():
        path = (prefix + "/" + name) if prefix else name
        if "files" in entry:
            yield from walk(entry, path)
        else:
            yield path, entry


def main():
    raw = BASE.read_bytes()
    _outer, buffer_size, _payload, string_size = struct.unpack_from("<IIII", raw, 0)
    content_start = 8 + buffer_size
    header, _ = json.JSONDecoder().raw_decode(raw[16:16 + string_size].decode("utf-8"))
    blobs = []
    for path, entry in walk(header):
        if "offset" not in entry or entry.get("unpacked"):
            continue
        if pathlib.PurePosixPath(path).suffix.lower() not in TEXT_EXT:
            continue
        start = content_start + int(entry["offset"])
        blobs.append((path, raw[start:start + int(entry["size"])]))
    for anchor in ANCHORS:
        blob = anchor.encode("utf-8")
        total = 0
        where = []
        for path, content in blobs:
            hits = content.count(blob)
            if hits:
                total += hits
                where.append("%s:%d" % (path, hits))
        print("%-4d  %s" % (total, anchor[:70]))
        if where and total <= 6:
            print("        " + ", ".join(where))
    return 0


if __name__ == "__main__":
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(errors="replace")
        except Exception:
            pass
    raise SystemExit(main())
