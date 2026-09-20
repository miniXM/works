# -*- coding: utf-8 -*-
"""打印 payload.zip 内关键条目的字节数与 SHA256，供 run-e2e2.ps1 的核对值使用。"""

import hashlib
import pathlib
import sys
import zipfile

TARGETS = [
    "videomix/resources/app.asar",
    "videomix/videomix.exe",
    "VideoMix.exe",
]


def main():
    archive = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else (
        pathlib.Path(__file__).resolve().parent / "build" / "payload.zip")
    with zipfile.ZipFile(archive) as zf:
        for name in TARGETS:
            digest = hashlib.sha256()
            size = 0
            with zf.open(name) as handle:
                for chunk in iter(lambda: handle.read(1 << 20), b""):
                    size += len(chunk)
                    digest.update(chunk)
            print("%-32s %12d  %s" % (name, size, digest.hexdigest()))
    return 0


if __name__ == "__main__":
    sys.exit(main())
