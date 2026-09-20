# -*- coding: utf-8 -*-
"""VS_VERSIONINFO（RT_VERSION）资源的解析与重建。

结构（微软文档 / PE 规范）：

    struct {
        WORD  wLength;          // 整个块的长度，含所有子块
        WORD  wValueLength;     // 文本类型(wType=1)按“字符数”算，二进制(wType=0)按字节算
        WORD  wType;            // 0 = 二进制, 1 = 文本
        WCHAR szKey[];          // 以 \0 结尾
        padding;                // 4 字节对齐（相对整个资源起始位置，也就是这里的 0 偏移）
        BYTE  Value[];          // wValueLength 指定的内容
        padding;
        Node  Children[];       // StringFileInfo / VarFileInfo ...
    }

只要解析再重建能逐字节还原原始 blob，就说明解析器是对的（见 self_test）。
"""

import struct

align4 = lambda n: (n + 3) & ~3


def parse(buf, offset=0):
    """解析一个块，返回 (node, 块结束偏移)。buf 必须是“整个资源”的字节串。"""
    length, value_length, value_type = struct.unpack_from("<HHH", buf, offset)
    if length <= 0:
        raise ValueError("块长度非法：%d @ %d" % (length, offset))
    end = offset + length

    pos = offset + 6
    key_start = pos
    while pos + 1 < len(buf) and buf[pos:pos + 2] != b"\x00\x00":
        pos += 2
    key = buf[key_start:pos].decode("utf-16-le")
    pos += 2
    pos = align4(pos)

    value = b""
    if value_length:
        size = value_length * 2 if value_type == 1 else value_length
        value = buf[pos:pos + size]
        if len(value) != size:
            raise ValueError("值越界 @ %d" % pos)
        pos += size
        pos = align4(pos)

    children = []
    while pos + 6 <= end:
        if pos + 6 > len(buf):
            break
        child, pos = parse(buf, pos)
        children.append(child)
        pos = align4(pos)

    return {"key": key, "type": value_type, "value": value,
            "value_length": value_length, "children": children}, end


def emit(node):
    """序列化一个块。块本身不加尾部填充，由父块在子块之间补齐到 4 字节。"""
    body = bytearray(node["key"].encode("utf-16-le") + b"\x00\x00")
    while (6 + len(body)) % 4:
        body += b"\x00"
    if node["value"]:
        body += node["value"]
        if node["children"]:
            while (6 + len(body)) % 4:
                body += b"\x00"
    for index, child in enumerate(node["children"]):
        if index:
            while (6 + len(body)) % 4:
                body += b"\x00"
        body += emit(child)
    value_length = node["value_length"] if node["value"] else 0
    return struct.pack("<HHH", 6 + len(body), value_length, node["type"]) + bytes(body)


def walk_strings(node, out=None):
    """收集所有“文本值”的叶子节点（CompanyName / FileDescription / ...）。

    注意：electron-builder 生成的这个资源里没有中间那层 "String" 块，
    语言块（040904b0）下面直接就是键值对，所以按“文本值 + 有键名”来判定。
    """
    if out is None:
        out = []
    for child in node["children"]:
        if child["type"] == 1 and child["value"]:
            out.append(child)
        else:
            walk_strings(child, out)
    return out


def text_of(node):
    return node["value"].decode("utf-16-le").rstrip("\x00")


def set_text(node, text):
    node["value"] = (text + "\x00").encode("utf-16-le")
    node["value_length"] = len(text) + 1


def self_test(blob):
    """解析再重建，必须和原数据逐字节一致（允许末尾对齐用的 0 填充）。"""
    root, end = parse(blob)
    fresh = emit(root)
    original = blob[:end]
    while len(original) % 4:
        original += b"\x00"
    if fresh != original:
        for index in range(min(len(fresh), len(original))):
            if fresh[index] != original[index]:
                raise AssertionError(
                    "重建结果和原文件不一致：第 %d 字节 0x%02x != 0x%02x" %
                    (index, fresh[index], original[index]))
        raise AssertionError("重建结果长度不一致：%d != %d" % (len(fresh), len(original)))
    return root, end
