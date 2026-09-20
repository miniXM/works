# -*- coding: utf-8 -*-
"""核对某个规则模块里 EXPECTED_HITS 与 base app.asar 的实际命中次数。

用法：python check-rule-hits.py persona_seed_rules [persona_rules ...]
"""

import importlib
import json
import pathlib
import struct
import sys

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
BASE = HERE / "base" / "app.asar"
TEXT_EXT = {".js", ".mjs", ".cjs", ".ts", ".css", ".html", ".json", ".yml",
            ".yaml", ".txt", ".svg", ".vue"}


def walk(node, prefix=""):
    for name, entry in node.get("files", {}).items():
        path = (prefix + "/" + name) if prefix else name
        if "files" in entry:
            yield from walk(entry, path)
        else:
            yield path, entry


def blobs():
    raw = BASE.read_bytes()
    _outer, buffer_size, _payload, string_size = struct.unpack_from("<IIII", raw, 0)
    content_start = 8 + buffer_size
    header, _ = json.JSONDecoder().raw_decode(raw[16:16 + string_size].decode("utf-8"))
    out = []
    for path, entry in walk(header):
        if "offset" not in entry or entry.get("unpacked"):
            continue
        if pathlib.PurePosixPath(path).suffix.lower() not in TEXT_EXT:
            continue
        start = content_start + int(entry["offset"])
        out.append((path, raw[start:start + int(entry["size"])]))
    return out


def main(argv):
    if len(argv) < 2:
        raise SystemExit("usage: check-rule-hits.py <module> [module ...]")
    data = blobs()
    failed = 0
    for name in argv[1:]:
        module = importlib.import_module(name)
        print("== %s ==" % name)
        rules = list(getattr(module, "RULES", []))
        expected = getattr(module, "EXPECTED_HITS", {})
        for old, _new in rules:
            blob = old.encode("utf-8")
            total = 0
            where = []
            for path, content in data:
                hits = content.count(blob)
                if hits:
                    total += hits
                    where.append("%s:%d" % (path, hits))
            want = expected.get(old)
            mark = "ok "
            if want is None:
                mark = "?  "
            elif want != total:
                mark = "BAD"
                failed += 1
            print("  %s 实际 %-2d 期望 %-4s %s" % (
                mark, total, "?" if want is None else want, old[:64].replace("\n", "\\n")))
            if where:
                print("        " + ", ".join(where))
        for old in expected:
            if not any(old == r[0] for r in rules):
                print("  BAD 期望表里有一条不在 RULES 里：%s" % old[:64])
                failed += 1
    print("RESULT %s" % ("pass" if not failed else "fail(%d)" % failed))
    return 1 if failed else 0


if __name__ == "__main__":
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(errors="replace")
        except Exception:
            pass
    raise SystemExit(main(sys.argv))
