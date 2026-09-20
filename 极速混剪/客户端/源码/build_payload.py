# -*- coding: utf-8 -*-
"""重建安装包 payload（zip）：只替换指定条目，其余条目原样搬运。

不走 .NET 的 ZipArchive（Update 模式会把整个 1GB 压缩包读进内存），
这里直接按中央目录逐条搬运原始数据，内存占用是常数级。

用法：
    python build_payload.py --base payload.zip --out new.zip \
        --replace videomix/resources/app.asar=app.asar \
        --replace "videomix/videomix.exe"=videomix.exe \
        --drop "videomix/Uninstall videomix.exe"
"""

import argparse
import pathlib
import struct
import sys
import time
import zlib

EOCD_SIG = b"PK\x05\x06"
CD_SIG = b"PK\x01\x02"
LOCAL_SIG = b"PK\x03\x04"


def read_directory(stream, size):
    """返回 (中央目录条目列表, eocd 字段)。条目里带上原始字段，便于原样重建。"""
    window = min(size, 66000)
    stream.seek(size - window)
    tail = stream.read(window)
    index = tail.rfind(EOCD_SIG)
    if index < 0:
        raise RuntimeError("找不到 zip 的 EOCD")
    eocd = tail[index:index + 22]
    (disk, cd_disk, n_disk, n_total, cd_size, cd_off, comment_len) = struct.unpack("<HHHHIIH", eocd[4:])
    if disk or cd_disk or n_disk != n_total:
        raise RuntimeError("不支持分卷 zip")
    if index + 22 + comment_len != len(tail):
        raise RuntimeError("EOCD 位置异常（可能有 zip64 或注释）")
    stream.seek(cd_off)
    cd = stream.read(cd_size)
    entries = []
    offset = 0
    while offset < len(cd):
        if cd[offset:offset + 4] != CD_SIG:
            raise RuntimeError("中央目录第 %d 字节的签名不对" % offset)
        fields = struct.unpack_from("<HHHHHHIIIHHHHHII", cd, offset + 4)
        (ver_made, ver_need, flag, method, mtime, mdate, crc, csize, usize,
         nlen, elen, clen, dstart, iattr, eattr, lho) = fields
        name = cd[offset + 46:offset + 46 + nlen]
        extra = cd[offset + 46 + nlen:offset + 46 + nlen + elen]
        comment = cd[offset + 46 + nlen + elen:offset + 46 + nlen + elen + clen]
        entries.append({"fields": fields, "name": name, "extra": extra,
                        "comment": comment, "local_offset": lho, "method": method,
                        "flag": flag, "crc": crc, "csize": csize, "usize": usize,
                        "mtime": mtime, "mdate": mdate, "ver_made": ver_made,
                        "ver_need": ver_need, "iattr": iattr, "eattr": eattr})
        offset += 46 + nlen + elen + clen
    if len(entries) != n_total:
        raise RuntimeError("中央目录条目数 %d 与 EOCD 的 %d 不一致" % (len(entries), n_total))
    return entries


def local_header_size(stream, entry):
    stream.seek(entry["local_offset"])
    head = stream.read(30)
    if head[:4] != LOCAL_SIG:
        raise RuntimeError("条目 %s 的本地头签名不对" % entry["name"])
    nlen, elen = struct.unpack_from("<HH", head, 26)
    return 30 + nlen + elen


def build_local_header(name, method, mtime, mdate, flag, crc, csize, usize):
    return struct.pack("<IHHHHHIIIHH", 0x04034B50, 20, flag, method, mtime, mdate,
                       crc, csize, usize, len(name), 0) + name


def build_central_header(entry, name, crc, csize, usize, offset, extra=b"", flag=None):
    _, ver_need, entry_flag, method, mtime, mdate, _, _, _, _, _, _, _, iattr, eattr, _ = entry["fields"]
    if flag is None:
        flag = entry_flag
    ver_made = entry["ver_made"]
    return (struct.pack("<IHHHHHHIIIHHHHHII", 0x02014B50, ver_made, ver_need, flag,
                        method, mtime, mdate, crc, csize, usize, len(name), len(extra), 0, 0,
                        iattr, eattr, offset) + name + extra)


def utf8_flag(name):
    try:
        name.decode("ascii")
        return 0
    except UnicodeDecodeError:
        return 0x800


def rewrite(base, out, replacements, drops=None):
    drops = drops or set()
    base_path = pathlib.Path(base)
    size = base_path.stat().st_size
    started = time.time()
    with base_path.open("rb") as stream:
        entries = read_directory(stream, size)
        central = bytearray()
        written = 0
        changed = []
        removed = []
        kept = 0
        with pathlib.Path(out).open("wb") as target:
            for index, entry in enumerate(entries):
                name = entry["name"]
                path = name.decode("utf-8")
                if name in drops:
                    removed.append(path)
                    continue
                kept += 1
                head_size = local_header_size(stream, entry)
                new_bytes = replacements.get(name)
                if new_bytes is None:
                    stream.seek(entry["local_offset"])
                    blob = stream.read(head_size + entry["csize"])
                    offset = written
                    target.write(blob)
                    written += len(blob)
                    central += build_central_header(entry, name, entry["crc"],
                                                    entry["csize"], entry["usize"], offset,
                                                    entry["extra"])
                else:
                    deflated = zlib.compressobj(9, zlib.DEFLATED, -15)
                    body = deflated.compress(new_bytes) + deflated.flush()
                    crc = zlib.crc32(new_bytes) & 0xFFFFFFFF
                    flag = (entry["flag"] & ~0x0008) | utf8_flag(name) | (entry["flag"] & 0x800)
                    head = build_local_header(name, 8, entry["mtime"], entry["mdate"],
                                              flag, crc, len(body), len(new_bytes))
                    offset = written
                    target.write(head)
                    target.write(body)
                    written += len(head) + len(body)
                    central += build_central_header(entry, name, crc, len(body),
                                                    len(new_bytes), offset, b"", flag)
                    changed.append((path, entry["usize"], len(new_bytes)))
                if (index + 1) % 250 == 0:
                    print("  已处理 %d/%d 条…" % (index + 1, len(entries)), flush=True)
            cd_offset = written
            target.write(central)
            written += len(central)
            target.write(struct.pack("<IHHHHIIH", 0x06054B50, 0, 0, kept,
                                     kept, len(central), cd_offset, 0))
    for path in removed:
        print("  移除 %s" % path)
    for path, old, new in changed:
        print("  替换 %-32s %s → %s 字节" % (path, format(old, ","), format(new, ",")))
    print("  输出 %s（%s 字节），用时 %.1f 秒" %
          (out, format(pathlib.Path(out).stat().st_size, ","), time.time() - started))
    return removed


def main(argv=None):
    parser = argparse.ArgumentParser(description="重建安装包 payload")
    parser.add_argument("--base", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--replace", action="append", default=[],
                        help="条目名=新文件路径（可重复）")
    parser.add_argument("--drop", action="append", default=[],
                        help="要从 payload 里删掉的条目名（可重复）")
    args = parser.parse_args(argv)

    replacements = {}
    for item in args.replace:
        if "=" not in item:
            parser.error("--replace 要写成 条目名=文件路径：%s" % item)
        name, path = item.split("=", 1)
        replacements[name.encode("utf-8")] = pathlib.Path(path).read_bytes()

    drops = set(name.encode("utf-8") for name in args.drop)
    rewrite(args.base, args.out, replacements, drops)
    return 0


if __name__ == "__main__":
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(errors="replace")
        except Exception:
            pass
    sys.exit(main())
