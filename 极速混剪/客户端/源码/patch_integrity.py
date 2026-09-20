# -*- coding: utf-8 -*-
"""更新 Electron 主程序里内置的 app.asar 完整性哈希。

exe 里有一个 ELECTRONASAR 资源（资源名是 UTF-16 的），内容是

    [{"file":"resources\\\\app.asar","alg":"SHA256","value":"<64 位十六进制>"}]

关于“哈希谁”：Electron 算的不是整个 asar 文件，而是 **asar 头部那段 JSON**
（第 16 字节起、长度 = 头里第 4 个 u32）的 SHA256。实测对照：

    基线 asar 整文件 SHA256 = 57e9a9e4…，头部 JSON SHA256 = c6236f8b…，
    而基线 exe 里写的正是 c6236f8b…  → 确认是头部 JSON。

改完 asar（哪怕只是换张图）头部 JSON 一定会变，所以这个值必须跟着更新，
否则 Electron 会以 “Integrity check failed for asar archive” 直接退出。

用法：
    python patch_integrity.py <exe> <新的 asar 路径> [--out <输出 exe>]
"""

import argparse
import hashlib
import pathlib
import re
import struct
import sys

MARKER = "ELECTRONASAR".encode("utf-16-le")
VALUE = re.compile(rb'"value":"([0-9a-fA-F]{64})"')


def patch(exe_path, asar_path, out_path=None):
    exe = pathlib.Path(exe_path)
    data = exe.read_bytes()
    digest = asar_header_hash(asar_path)

    marker = data.find(MARKER)
    if marker < 0:
        raise SystemExit("exe 里找不到 ELECTRONASAR 资源，不做改动")
    window = data[marker:marker + 4096]
    found = VALUE.search(window)
    if not found:
        raise SystemExit("ELECTRONASAR 资源里找不到 value 字段")
    old = found.group(1).decode("ascii")
    if old == digest:
        print("  完整性哈希已经是最新的（%s）" % digest[:16])
        return digest
    start = marker + found.start(1)
    end = marker + found.end(1)
    data = data[:start] + digest.encode("ascii") + data[end:]
    pathlib.Path(out_path or exe_path).write_bytes(data)
    print("  完整性哈希：%s → %s" % (old[:16] + "…", digest[:16] + "…"))
    check = pathlib.Path(out_path or exe_path).read_bytes()
    marker = check.find(MARKER)
    now = VALUE.search(check[marker:marker + 4096]).group(1).decode("ascii")
    if now != digest:
        raise SystemExit("写完再读回来对不上：%s != %s" % (now, digest))
    return digest


def asar_header_hash(asar_path):
    """按 Electron 的口径算：asar 头部 JSON 的 SHA256。"""
    raw = pathlib.Path(asar_path).read_bytes()
    outer, buffer_size, payload_size, string_size = struct.unpack_from("<IIII", raw, 0)
    if outer != 4 or 8 + buffer_size != 12 + payload_size:
        raise SystemExit("asar 头部格式不对：%s" % asar_path)
    return hashlib.sha256(raw[16:16 + string_size]).hexdigest()


def main(argv=None):
    parser = argparse.ArgumentParser(description="更新 exe 里的 asar 完整性哈希")
    parser.add_argument("exe")
    parser.add_argument("asar")
    parser.add_argument("--out")
    args = parser.parse_args(argv)
    patch(args.exe, args.asar, args.out)
    return 0


if __name__ == "__main__":
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(errors="replace")
        except Exception:
            pass
    sys.exit(main())
