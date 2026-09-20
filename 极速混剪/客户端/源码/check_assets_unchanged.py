# -*- coding: utf-8 -*-
"""对比“只换文字”前后的 app.asar / exe：确认图标和 logo 图片一个字节都没动。

用法：python check_assets_unchanged.py
"""

import hashlib
import json
import pathlib
import struct
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import patch_exe as px  # noqa: E402

BASE_EXE = pathlib.Path(r"work\rebrand\base\videomix.exe")
NEW_EXE = pathlib.Path(r"work\rebrand\build\out\videomix.exe")
BASE_ASAR = pathlib.Path(r"work\rebrand\base\app.asar")
NEW_ASAR = pathlib.Path(r"work\rebrand\build\out\app.asar")

IMAGE_ENTRIES = [
    "dist/app-icon.png",
    "dist/tray-icon.png",
    "dist/favicon.png",
    "dist/favicon.ico",
    "dist/favicon.svg",
    "dist/assets/\u521b\u8230-CaezdxB6.png",
    "dist/assets/\u521b\u82301-bJwsFj2F.png",
]


def icon_digests(path):
    module = px.k32.LoadLibraryExW(str(path.resolve()), None, px.LOAD_LIBRARY_AS_DATAFILE)
    if not module:
        raise SystemExit("\u6253\u4e0d\u5f00 %s" % path)
    try:
        return {rid: hashlib.sha256(px.read_resource(module, px.RT_ICON, rid)).hexdigest()[:12]
                for rid in px.list_resources(module, px.RT_ICON)}
    finally:
        px.k32.FreeLibrary(module)


def load_asar(path):
    raw = path.read_bytes()
    buffer_size, _, string_size = struct.unpack_from("<III", raw, 4)
    header, _ = json.JSONDecoder().raw_decode(raw[16:16 + string_size].decode("utf-8"))
    return raw, header, 8 + buffer_size


def entry_bytes(loaded, wanted):
    raw, header, start = loaded
    stack = [("", header)]
    while stack:
        prefix, node = stack.pop()
        for name, item in node.get("files", {}).items():
            path = (prefix + "/" + name) if prefix else name
            if "files" in item:
                stack.append((path, item))
            elif path == wanted:
                offset = start + int(item["offset"])
                return raw[offset:offset + int(item["size"])]
    return None


def main():
    failures = 0

    base_icons = icon_digests(BASE_EXE)
    new_icons = icon_digests(NEW_EXE)
    same = base_icons == new_icons
    failures += 0 if same else 1
    print("%s  exe \u56fe\u6807\u8d44\u6e90 %s  %s" % (
        "PASS" if same else "FAIL", json.dumps(new_icons, sort_keys=True),
        "(\u4e0e\u539f\u7248\u4e00\u81f4)" if same else "(\u4e0e\u539f\u7248\u4e0d\u4e00\u81f4)"))

    base_asar = load_asar(BASE_ASAR)
    new_asar = load_asar(NEW_ASAR)
    for name in IMAGE_ENTRIES:
        before = entry_bytes(base_asar, name)
        after = entry_bytes(new_asar, name)
        if before is None or after is None:
            print("FAIL  %s  \u6761\u76ee\u7f3a\u5931" % name)
            failures += 1
            continue
        same = hashlib.sha256(before).digest() == hashlib.sha256(after).digest()
        failures += 0 if same else 1
        print("%s  %-42s %s" % ("PASS" if same else "FAIL", name,
                                "(\u4e0e\u539f\u7248\u4e00\u81f4)" if same else "(\u88ab\u6539\u52a8)"))

    print("RESULT fail=%d" % failures)
    return 1 if failures else 0


if __name__ == "__main__":
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(errors="replace")
        except Exception:
            pass
    sys.exit(main())
