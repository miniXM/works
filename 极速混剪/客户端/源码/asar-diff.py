# -*- coding: utf-8 -*-
"""比较两个 app.asar 里每个文件的差异。

usage: asar-diff.py <asarA> <asarB> [--limit N]
"""
import hashlib
import json
import pathlib
import struct
import sys

sys.stdout.reconfigure(encoding="utf-8", errors="replace")


def walk(node, prefix=""):
    for name, entry in node.get("files", {}).items():
        path = (prefix + "/" + name) if prefix else name
        if "files" in entry:
            yield from walk(entry, path)
        else:
            yield path, entry


def load(asar):
    raw = asar.read_bytes()
    outer, buffer_size, payload_size, string_size = struct.unpack_from("<IIII", raw, 0)
    content_start = 8 + buffer_size
    header, _ = json.JSONDecoder().raw_decode(raw[16:16 + string_size].decode("utf-8"))
    out = {}
    for path, entry in walk(header):
        start = content_start + int(entry["offset"])
        blob = raw[start:start + int(entry["size"])]
        out[path] = blob
    return out


def main(argv):
    a = load(pathlib.Path(argv[1]))
    b = load(pathlib.Path(argv[2]))
    limit = 200
    if "--limit" in argv:
        limit = int(argv[argv.index("--limit") + 1])

    only_a = sorted(set(a) - set(b))
    only_b = sorted(set(b) - set(a))
    common = sorted(set(a) & set(b))
    changed = [p for p in common if a[p] != b[p]]

    print("A = %s（%d 个文件）" % (argv[1], len(a)))
    print("B = %s（%d 个文件）" % (argv[2], len(b)))
    print("只有 A 有：%d" % len(only_a))
    for p in only_a[:limit]:
        print("   - %s  %d 字节" % (p, len(a[p])))
    print("只有 B 有：%d" % len(only_b))
    for p in only_b[:limit]:
        print("   + %s  %d 字节" % (p, len(b[p])))
    print("两边都有但内容不同：%d" % len(changed))
    for p in changed[:limit]:
        print("   * %s  A=%d B=%d  sha A=%s B=%s" % (
            p, len(a[p]), len(b[p]),
            hashlib.sha256(a[p]).hexdigest()[:16],
            hashlib.sha256(b[p]).hexdigest()[:16]))
    print("__RUN_END__")


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
