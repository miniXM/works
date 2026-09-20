# -*- coding: utf-8 -*-
"""自检 build_payload.py：造一个小 zip，验证“原样搬运”和“替换条目”两种结果都正确。"""

import pathlib
import sys
import zipfile

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import build_payload  # noqa: E402

HERE = pathlib.Path(__file__).resolve().parent / "tmp"


def make_zip(path):
    payload = {
        "videomix/a.txt": "你好，这是测试".encode("utf-8"),
        "videomix/b.bin": bytes(range(256)) * 8192,          # 2MB
        "使用说明.txt": "说明".encode("utf-8"),
        "VideoMix.exe": b"MZ" + bytes(5000),
    }
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as zf:
        for name, data in payload.items():
            zf.writestr(name, data)
    return payload


def check(label, condition, detail=""):
    print("%s  %s %s" % ("PASS" if condition else "FAIL", label, detail))
    return condition


def main():
    HERE.mkdir(parents=True, exist_ok=True)
    base = HERE / "base.zip"
    same = HERE / "same.zip"
    changed = HERE / "changed.zip"
    payload = make_zip(base)
    ok = True

    build_payload.rewrite(base, same, {})
    ok &= check("原样搬运：字节完全一致", base.read_bytes() == same.read_bytes(),
                "(%d 字节)" % same.stat().st_size)

    fresh = "新品牌的新说明".encode("utf-8")
    build_payload.rewrite(base, changed, {"使用说明.txt".encode("utf-8"): fresh})
    with zipfile.ZipFile(changed) as zf:
        ok &= check("替换后仍然是个合法 zip", zf.testzip() is None)
        ok &= check("替换的条目内容正确", zf.read("使用说明.txt") == fresh)
        for name, data in payload.items():
            if name == "使用说明.txt":
                continue
            ok &= check("未动的条目原样保留：%s" % name, zf.read(name) == data)
        ok &= check("条目数量不变", len(zf.namelist()) == len(payload),
                    "%d" % len(zf.namelist()))
    return 0 if ok else 1


if __name__ == "__main__":
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(errors="replace")
        except Exception:
            pass
    sys.exit(main())
