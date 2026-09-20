# -*- coding: utf-8 -*-
"""把本次任务的材料打成几个 zip，方便换电脑继续做。

用 Python 的 zipfile 而不是 Windows 的 tar.exe：tar 写进 zip 的中文文件名字节
会按本地代码页编码，解压出来是乱码；Python 会正确写 UTF-8 名字标记。

三个包：
    A 源码脚本 + 授权后台 + 密钥 + 文档 + 截图   体积小，换机器继续开发用
    B 重建素材 work/rebrand/base                重新出安装包必需
    C 成品安装包 outputs/videomix-rebuild       已经打好的 exe
    D 出包工作区 work/videomix-rebuild          含 stage（安装树 / 字体），没它 rebrand.py 跑不起来
    E 界面快照   work/rebrand/ui-versions       旧界面一键回退用，可选
"""
import pathlib
import sys
import zipfile

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = pathlib.Path(r"E:\GPT Codex\2026-09-15\new-chat")
OUT = ROOT / "outputs" / "备份"
STAMP = "20260918"

A_PREFIXES = [
    ("work/rebrand", ("*.py", "*.ps1", "*.json", "*.md", "*.txt", "*.log", "*.sed")),
    # 界面皮肤（整套 UI 的 CSS + 白天/暗黑主题脚本），少了它换机器就出不了同一套界面
    ("work/rebrand/skin", ("*",)),
    ("work/rebrand/assets", ("*",)),
    ("work/rebrand/mainui", ("*",)),
    ("work/rebrand/base-asardist", ("*",)),
    ("work/rebrand/probe", ("*.py", "*.ps1", "*.txt", "*.js", "*.md")),
    ("work/videomix-rebuild/sfx", ("*",)),
    ("work/videomix-rebuild/keys", ("*",)),
    ("work/videomix-rebuild/licenseserver", ("*",)),
    ("work/videomix-rebuild/asar", ("*",)),
    ("work/videomix-rebuild/evidence", ("*",)),
    ("work/videomix-rebuild/cstest", ("*",)),
    ("work/videomix-rebuild/ls-test", ("*",)),
    ("work/videomix-rebuild/notes", ("*",)),
    ("work/videomix-rebuild/report", ("*",)),
    ("outputs/videomix-web", ("*",)),
    ("outputs/videomix-rebuild/截图", ("*",)),
    ("outputs", ("*.md",)),
]

A_FILES = [
    "work/videomix-rebuild/build-client-update.ps1",
    "work/videomix-rebuild/build-launcher.ps1",
    "work/videomix-rebuild/build-licenseserver.ps1",
    "work/videomix-rebuild/build-setup.ps1",
    "work/videomix-rebuild/client-version.txt",
    "work/videomix-rebuild/default-server.txt",
    "work/videomix-rebuild/installer.sed",
    "work/videomix-rebuild/probe-license.ps1",
    "work/videomix-rebuild/README.md",
    "work/videomix-rebuild/run-e2e2.ps1",
    "work/videomix-rebuild/scan-endpoints.py",
    "work/videomix-rebuild/scope.md",
    "work/videomix-rebuild/test-license.ps1",
    "work/videomix-rebuild/timeline.md",
    "work/videomix-rebuild/update-payload-entry.ps1",
    "work/videomix-rebuild/workitems.md",
    "outputs/videomix-rebuild/技术说明.md",
    "outputs/videomix-rebuild/README.md",
    "outputs/videomix-rebuild/品牌素材清单.md",
    "outputs/videomix-rebuild/VideoMix-LicenseServer.exe",
    "outputs/备份/恢复说明.md",
]

SKIP_NAMES = {"test-keys.local.json"}
SKIP_PARTS = {"__pycache__"}


def collect_a():
    items = []
    for prefix, patterns in A_PREFIXES:
        base = ROOT / prefix
        if not base.exists():
            continue
        for path in sorted(base.rglob("*")):
            if not path.is_file():
                continue
            if path.name in SKIP_NAMES:
                continue
            if any(part in SKIP_PARTS for part in path.parts):
                continue
            if not any(path.match(pattern) for pattern in patterns):
                continue
            items.append(path)
    for name in A_FILES:
        path = ROOT / name
        if path.is_file():
            items.append(path)
    return sorted(set(items))


def add_tree(archive, base, compress, label):
    files = [p for p in sorted(base.rglob("*")) if p.is_file()]
    total = 0
    for index, path in enumerate(files, 1):
        archive.write(path, path.relative_to(ROOT).as_posix(), compress_type=compress)
        total += path.stat().st_size
        if index % 500 == 0:
            print("    %s %d/%d" % (label, index, len(files)), flush=True)
    print("    %s 共 %d 个文件，%d 字节" % (label, len(files), total), flush=True)


def make_zip(name, files=None, tree=None, compress=zipfile.ZIP_DEFLATED):
    OUT.mkdir(parents=True, exist_ok=True)
    target = OUT / name
    if target.exists():
        target.unlink()
    print("\n=== %s ===" % name, flush=True)
    with zipfile.ZipFile(target, "w", compress, allowZip64=True) as archive:
        if files is not None:
            for index, path in enumerate(files, 1):
                archive.write(path, path.relative_to(ROOT).as_posix(), compress_type=compress)
                if index % 200 == 0:
                    print("    %d/%d" % (index, len(files)), flush=True)
            print("    共 %d 个文件" % len(files), flush=True)
        if tree is not None:
            add_tree(archive, tree, compress, "tree")
    size = target.stat().st_size
    print("    产出 %s（%.1f MB）" % (target, size / 1048576.0), flush=True)
    return target


def main():
    only = ""
    if "--only" in sys.argv:
        only = sys.argv[sys.argv.index("--only") + 1].strip().lower()
    a_files = collect_a()
    print("包 A 选中 %d 个文件" % len(a_files))
    if only in ("", "a"):
        make_zip("VideoMix-任务备份-源码脚本-%s.zip" % STAMP, files=a_files)
    if only in ("", "b"):
        # base 和安装包本身已经是压缩过的（zip / exe），再压一遍只浪费时间
        make_zip("VideoMix-任务备份-重建素材-%s.zip" % STAMP,
                 tree=ROOT / "work" / "rebrand" / "base", compress=zipfile.ZIP_STORED)
    if only in ("", "c"):
        make_zip("VideoMix-任务备份-成品安装包-%s.zip" % STAMP,
                 tree=ROOT / "outputs" / "videomix-rebuild", compress=zipfile.ZIP_STORED)
    if only in ("", "d"):
        # stage 是"装好之后"的安装树：rebrand.py 要往它里面同步 asar/exe，
        # 还要从它里面取标题字体（resources/fonts）。base 只存了原始
        # app.asar / videomix.exe / payload.zip，重建不出 stage 来。
        make_zip("VideoMix-任务备份-出包工作区-%s.zip" % STAMP,
                 tree=ROOT / "work" / "videomix-rebuild", compress=zipfile.ZIP_STORED)
    if only in ("", "e"):
        make_zip("VideoMix-任务备份-界面快照-%s.zip" % STAMP,
                 tree=ROOT / "work" / "rebrand" / "ui-versions", compress=zipfile.ZIP_STORED)
    print("\n__RUN_END__")


if __name__ == "__main__":
    main()
