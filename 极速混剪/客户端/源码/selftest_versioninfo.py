# -*- coding: utf-8 -*-
"""自检：从 exe 里取出 RT_VERSION，解析再重建，必须逐字节一致。"""

import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import pefile  # noqa: E402
import versioninfo  # noqa: E402


def version_blob(path):
    pe = pefile.PE(str(path), fast_load=True)
    pe.parse_data_directories(directories=[pefile.DIRECTORY_ENTRY["IMAGE_DIRECTORY_ENTRY_RESOURCE"]])
    for entry in pe.DIRECTORY_ENTRY_RESOURCE.entries:
        if entry.id != 16:  # RT_VERSION
            continue
        for name in entry.directory.entries:
            for lang in name.directory.entries:
                data = lang.data.struct
                return pe.get_memory_mapped_image()[
                    data.OffsetToData:data.OffsetToData + data.Size]
    raise SystemExit("没有 RT_VERSION 资源")


def main(path):
    blob = version_blob(path)
    print("RT_VERSION 大小：%d 字节" % len(blob))
    root, end = versioninfo.self_test(blob)
    print("自检通过：块长度 %d，资源长度 %d，末尾填充 %d 字节" %
          (struct_length(root), end, len(blob) - end))
    for node in versioninfo.walk_strings(root):
        print("  %-20s %s" % (node["key"], versioninfo.text_of(node)))
    return 0


def struct_length(node):
    return 6 + sum(struct_length_node(child) for child in node["children"])


def struct_length_node(node):
    return 6


if __name__ == "__main__":
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(errors="replace")
        except Exception:
            pass
    target = sys.argv[1] if len(sys.argv) > 1 else \
        r"E:\GPT Codex\2026-09-15\new-chat\work\videomix-rebuild\stage\videomix\videomix.exe"
    sys.exit(main(target))
