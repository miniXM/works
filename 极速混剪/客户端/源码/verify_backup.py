# -*- coding: utf-8 -*-
"""检查备份 zip 能不能正常打开、中文文件名正不正确、内容完不完整。"""
import hashlib
import pathlib
import sys
import zipfile

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

OUT = pathlib.Path(r"E:\GPT Codex\2026-09-15\new-chat\outputs\备份")


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main():
    ok = True
    for name in sorted(OUT.glob("*.zip")):
        print("=" * 70)
        print(name.name, "%.1f MB" % (name.stat().st_size / 1048576.0))
        print("SHA256", sha256(name))
        with zipfile.ZipFile(name) as archive:
            bad = archive.testzip()
            names = archive.namelist()
            print("条目数 %d，损坏条目 %s" % (len(names), bad or "无"))
            utf8_bad = []
            for info in archive.infolist():
                if any(ord(ch) > 127 for ch in info.filename) and not (info.flag_bits & 0x800):
                    utf8_bad.append(info.filename)
            print("中文名但没标 UTF-8 的条目：%d" % len(utf8_bad))
            for sample in names[:2]:
                print("   ", sample)
            chinese = [n for n in names if any(ord(ch) > 127 for ch in n)]
            print("中文路径示例：")
            for sample in chinese[:3]:
                print("   ", sample)
            if bad or utf8_bad:
                ok = False
    print("=" * 70)
    print("ALL OK" if ok else "有问题")
    print("__RUN_END__")


if __name__ == "__main__":
    main()
