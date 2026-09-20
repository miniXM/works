# -*- coding: utf-8 -*-
"""从 app.asar 里取出 dist/index.html，检查里面的 <title> 是不是新品牌名。

用法：python check_asar_title.py <app.asar> <期望的名字>
"""

import json
import pathlib
import re
import struct
import sys


def read_entry(raw, header, content_start, wanted):
    stack = [("", header)]
    while stack:
        prefix, node = stack.pop()
        for name, entry in node.get("files", {}).items():
            path = (prefix + "/" + name) if prefix else name
            if "files" in entry:
                stack.append((path, entry))
            elif path == wanted:
                start = content_start + int(entry["offset"])
                return raw[start:start + int(entry["size"])]
    return None


def main(asar, expected):
    raw = pathlib.Path(asar).read_bytes()
    buffer_size, _, string_size = struct.unpack_from("<III", raw, 4)
    header, _ = json.JSONDecoder().raw_decode(raw[16:16 + string_size].decode("utf-8"))
    content_start = 8 + buffer_size

    html = read_entry(raw, header, content_start, "dist/index.html")
    if html is None:
        print("FAIL  找不到 dist/index.html")
        return 1
    text = html.decode("utf-8")
    title = re.search(r"<title>(.*?)</title>", text)
    title = title.group(1) if title else ""
    splash = re.search(r'vm-startup__title">(.*?)<', text)
    splash = splash.group(1) if splash else ""
    brand = re.search(r'vm-startup__brand">(.*?)<', text)
    brand = brand.group(1) if brand else ""
    print("info  标题=%s  启动页=%s / %s" % (title, brand, splash))
    ok = title == expected
    print("%s  界面标题 %r == %r" % ("PASS" if ok else "FAIL", title, expected))
    return 0 if ok else 1


if __name__ == "__main__":
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(errors="replace")
        except Exception:
            pass
    sys.exit(main(sys.argv[1], sys.argv[2]))
