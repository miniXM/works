# -*- coding: utf-8 -*-
"""重建 Electron 的 app.asar：替换品牌文案 + 替换 logo 图片，并刷新完整性哈希。

头部布局（和厂商的包一致，逐字节对齐）：

    [u32 outer_payload_size = 4]
    [u32 header_buffer_size]  = 4 + payload_size
    [u32 payload_size]        = round_up4(4 + string_length)
    [u32 string_length]       = len(json)
    [json bytes][补零到 4 字节]
    [文件内容区]               -> 从 8 + header_buffer_size 开始

入口的 offset 相对“文件内容区”起始位置；每个改动过的条目会重算 SHA256 完整性。

用法：
    python build_asar.py --base in.asar --out out.asar \
        --rules rules.json [--identity-check]

rules.json：
    {
      "text":   [["旧文案", "新文案"], ...],          # 按顺序做替换
      "images": {"dist/app-icon.png": "新图标.png"},  # 整份替换的条目
      "add":    {"dist/assets/vm-skin.css": "皮肤.css"},  # 新增文件（asar 里原本没有）
      "skip_text_ext": [".map"]                       # 可选，不参与文本替换的后缀
    }
"""

import argparse
import hashlib
import json
import pathlib
import struct
import sys

TEXT_EXT = {".js", ".mjs", ".cjs", ".ts", ".css", ".html", ".htm", ".json",
            ".yml", ".yaml", ".txt", ".svg", ".vue"}


def walk(node, prefix=""):
    for name, entry in node.get("files", {}).items():
        path = (prefix + "/" + name) if prefix else name
        if "files" in entry:
            yield from walk(entry, path)
        else:
            yield path, entry


def read_asar(raw):
    outer, buffer_size, payload_size, string_size = struct.unpack_from("<IIII", raw, 0)
    if outer != 4:
        raise RuntimeError("外层 pickle 长度不是 4：%d" % outer)
    content_start = 8 + buffer_size
    if content_start != 12 + payload_size:
        raise RuntimeError("头部长度自相矛盾：%d != %d" % (content_start, 12 + payload_size))
    header, _ = json.JSONDecoder().raw_decode(raw[16:16 + string_size].decode("utf-8"))
    return header, content_start


def refresh_integrity(entry, content):
    integrity = entry.get("integrity")
    if not integrity:
        return
    block_size = int(integrity.get("blockSize") or 4194304)
    integrity.clear()
    integrity.update(make_integrity(content, block_size))


def make_integrity(content, block_size=4194304):
    blocks = [hashlib.sha256(content[start:start + block_size]).hexdigest()
              for start in range(0, len(content), block_size)]
    return {"algorithm": "SHA256", "hash": hashlib.sha256(content).hexdigest(),
            "blockSize": block_size,
            "blocks": blocks or [hashlib.sha256(b"").hexdigest()]}


def insert_entry(header, path, content):
    """在 asar 头部树里新增一个文件条目，返回它的 entry（offset 稍后统一重排）。"""
    parts = path.split("/")
    node = header
    for part in parts[:-1]:
        node = node.setdefault("files", {}).setdefault(part, {"files": {}})
    # 新条目也必须带 integrity，否则开了 ASAR 完整性校验的客户端起不来
    entry = {"size": len(content), "offset": "0", "integrity": make_integrity(content)}
    node.setdefault("files", {})[parts[-1]] = entry
    return entry


def build(base, rules):
    raw = pathlib.Path(base).read_bytes()
    header, content_start = read_asar(raw)

    text_rules = [(old, new) for old, new in rules.get("text", [])]
    image_rules = {k.replace("\\", "/"): pathlib.Path(v)
                   for k, v in rules.get("images", {}).items()}
    add_rules = {k.replace("\\", "/"): pathlib.Path(v)
                 for k, v in rules.get("add", {}).items()}
    skip_ext = set(rules.get("skip_text_ext", []))

    contents = {}
    entries = {}
    counts = {old: 0 for old, _ in text_rules}
    replaced_images = []
    added_files = []
    modified = []

    for path, entry in walk(header):
        if "offset" not in entry or entry.get("unpacked"):
            continue
        entries[path] = entry
        start = content_start + int(entry["offset"])
        content = raw[start:start + int(entry["size"])]
        touched = False

        if path in image_rules or path in add_rules:
            content = (image_rules.get(path) or add_rules[path]).read_bytes()
            (replaced_images if path in image_rules else added_files).append(path)
            touched = True
        elif pathlib.PurePosixPath(path).suffix.lower() in TEXT_EXT \
                and pathlib.PurePosixPath(path).suffix.lower() not in skip_ext:
            for old, new in text_rules:
                blob = old.encode("utf-8")
                hits = content.count(blob)
                if not hits:
                    continue
                content = content.replace(blob, new.encode("utf-8"))
                counts[old] += hits
                touched = True

        if touched:
            modified.append(path)
            refresh_integrity(entry, content)
        contents[path] = content

    for path in image_rules:
        if path not in replaced_images:
            raise RuntimeError("规则里的图片条目在 asar 里不存在：%s" % path)

    # asar 里本来没有的新文件：连头部条目一起加进去
    for path, source in add_rules.items():
        if path in entries:
            continue
        content = source.read_bytes()
        entries[path] = insert_entry(header, path, content)
        contents[path] = content
        added_files.append(path)

    position = 0
    for path, content in contents.items():
        entry = entries[path]
        entry["offset"] = str(position)
        entry["size"] = len(content)
        position += len(content)

    json_bytes = json.dumps(header, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    string_size = len(json_bytes)
    payload_size = (4 + string_size + 3) & ~3
    buffer_size = 4 + payload_size

    out = bytearray(struct.pack("<IIII", 4, buffer_size, payload_size, string_size))
    out.extend(json_bytes)
    out.extend(b"\0" * (payload_size - 4 - string_size))
    if len(out) != 8 + buffer_size:
        raise RuntimeError("头部自检失败")
    for content in contents.values():
        out.extend(content)
    return bytes(out), counts, modified, replaced_images, added_files


def main(argv=None):
    parser = argparse.ArgumentParser(description="重建 app.asar 的品牌信息")
    parser.add_argument("--base", required=True)
    parser.add_argument("--out")
    parser.add_argument("--rules")
    parser.add_argument("--identity-check", action="store_true",
                        help="不做任何替换，验证重建逻辑与原文件逐字节一致")
    args = parser.parse_args(argv)

    if args.identity_check:
        rules = {"text": [], "images": {}}
    else:
        if not args.rules or not args.out:
            parser.error("需要 --rules 和 --out")
        rules = json.loads(pathlib.Path(args.rules).read_text(encoding="utf-8"))

    fresh, counts, modified, images, added = build(args.base, rules)

    if args.identity_check:
        original = pathlib.Path(args.base).read_bytes()
        if fresh == original:
            print("自检通过：重建结果与原 asar 逐字节一致（%s 字节）" % format(len(fresh), ","))
            return 0
        limit = min(len(fresh), len(original))
        where = next((i for i in range(limit) if fresh[i] != original[i]), limit)
        print("自检失败：第 %d 字节不同，长度 %d vs %d" %
              (where, len(fresh), len(original)))
        print("  新：%r" % fresh[max(0, where - 40):where + 40])
        print("  旧：%r" % original[max(0, where - 40):where + 40])
        return 1

    for old, hits in counts.items():
        print("  文案替换 %-24s ×%d%s" % (old, hits, "" if hits else "   <== 一条都没命中"))
    for path in images:
        print("  图片替换 %s" % path)
    for path in added:
        print("  新增文件 %s" % path)
    print("  改动条目 %d 个" % len(modified))
    pathlib.Path(args.out).write_bytes(fresh)
    print("  输出 %s（%s 字节）" % (args.out, format(len(fresh), ",")))
    return 0


if __name__ == "__main__":
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(errors="replace")
        except Exception:
            pass
    sys.exit(main())
