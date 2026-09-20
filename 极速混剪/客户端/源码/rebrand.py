# -*- coding: utf-8 -*-
"""一键换品牌：按 brand.json 重新生成客户端 + 安装包。

做四件事：
    1) 生成图标 / logo（没给图就用品牌名自动画一个）
    2) 重建 app.asar（改界面里的品牌文案 + 换 logo 图），同步 exe 里的完整性哈希
    3) 改写 videomix.exe 的图标和文件属性（公司名 / 产品名 / 版权）
    4) 重编安装程序、重打 payload，输出新的安装包

基准素材（未改品牌的原始文件）存在 work\\rebrand\\base 下，只在第一次运行或加
--reset-base 时刷新，所以改完还能再改回去、或者换个名字再出一版。

用法：
    python rebrand.py                        # 用 brand.json 出包
    python rebrand.py --config 别的.json --setup-name 我的软件-Setup-1.1.2.exe
    python rebrand.py --no-pack              # 只生成文件，不拼 1GB 安装包
    python rebrand.py --reset-base           # 重新抓一份基准素材
"""

import argparse
import hashlib
import json
import pathlib
import shutil
import subprocess
import sys
import time

HERE = pathlib.Path(__file__).resolve().parent
PYTHON = r"C:\Users\Administrator\AppData\Local\Programs\Python\Python312\python.exe"
PWSH = (r"C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime"
        r"\dependencies\native\powershell\pwsh.exe")
DEFAULT_ROOT = pathlib.Path(r"E:\GPT Codex\2026-09-15\new-chat\work\videomix-rebuild")
DEFAULT_OUT = pathlib.Path(r"E:\GPT Codex\2026-09-15\new-chat\outputs\videomix-rebuild")
DEFAULT_FONT = DEFAULT_ROOT / "stage" / "videomix" / "resources" / "fonts" / "AlibabaPuHuiTi-3-105-Heavy.ttf"

USAGE_TEMPLATE = """{name} 使用说明
{line}

1. 双击桌面上的 {slug} 快捷方式启动（不要直接运行 {folder}\\{main_exe}，
   该方式不会启动本机授权代理）。

2. 首次启动会显示“设备激活”页面，页面上方是本机设备 ID。
   输入授权方发放的激活码，点“登录”完成激活。

3. 激活成功后，激活码与本机设备 ID 会缓存在本机；
   以后每次打开都会停在“设备激活”页面，激活码已经自动填好，
   点一下“登录”即可进入主界面，不用重新输入。

   客户端每 2 分钟自动向授权服务器复核一次有效期与设备绑定状态；
   授权到期、被禁用或换了电脑时，激活码仍然留在输入框里，
   点“登录”后才会提示具体原因（如“激活码已过期”“设备码不匹配”），
   这时候请联系授权方处理。

4. 授权服务器由安装包内置、由授权方统一管理，正常使用不需要你设置。
   换电脑使用请联系授权方解绑，不要自行修改安装目录下的配置文件。

5. 卸载（三种方式任选一种）：
   ① 开始菜单 → 找到“卸载 {display}”，双击；
   ② 设置 → 应用 / 控制面板 → 程序和功能 → 找到“{display}” → 卸载；
   ③ 打开安装目录，运行 {launcher} /uninstall。
"""


def log(message):
    print(message, flush=True)


def run(command, **kwargs):
    log("  > " + " ".join(str(part) for part in command[:4]) + (" …" if len(command) > 4 else ""))
    result = subprocess.run(command, **kwargs)
    if result.returncode != 0:
        raise SystemExit("命令失败（退出码 %d）：%s" % (result.returncode, command[0]))
    return result


def sha256(path):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_config(path):
    config = json.loads(pathlib.Path(path).read_text(encoding="utf-8"))
    config.setdefault("slug", config.get("nameEn") or "VideoMix")
    config.setdefault("displayName", "%s %s" % (config["slug"], config["name"]))
    config.setdefault("installFolderName", config["slug"])
    config.setdefault("company", config["name"])
    config.setdefault("copyright", "Copyright © 2026 " + config["company"])
    config.setdefault("version", "1.1.2")
    config.setdefault("setupName", "%s-Setup-%s.exe" % (config["slug"], config["version"]))
    config["slug"] = config["slug"].strip()
    return config


def ensure_base(root, base_dir, reset):
    base_dir.mkdir(parents=True, exist_ok=True)
    sources = {
        "app.asar": root / "stage" / "videomix" / "resources" / "app.asar",
        "videomix.exe": root / "stage" / "videomix" / "videomix.exe",
        "payload.zip": root / "stage-payload-6.zip",
    }
    for name, source in sources.items():
        target = base_dir / name
        if reset or not target.exists():
            if not source.exists():
                raise SystemExit("找不到基准素材：%s" % source)
            log("  刷新基准素材 %s（来自 %s）" % (name, source.name))
            shutil.copyfile(source, target)
    return {name: base_dir / name for name in sources}


BRAND_CS = u"""// 品牌常量。由 work\\rebrand\\rebrand.py 依据 brand.json 生成，不要手改。
internal static class Brand
{
    internal const string Name = @NAME@;
    internal const string ShortName = @SLUG@;
    internal const string Publisher = @COMPANY@;
    internal const string Copyright = @COPYRIGHT@;

    internal const string InstallFolderName = @FOLDER@;
    internal const string ShortcutFileName = @SLUG@ + ".lnk";
    internal const string UninstallKeyPath = @"Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\" + @SLUG@;

    internal const string LauncherExeName = "VideoMix.exe";
    internal const string MainExeName = "videomix.exe";
    internal const string UserAgent = @SLUG@ + "Launcher";

    internal const string InstallerTitle = @NAME@ + " 安装程序";
    internal const string WizardTitle = @NAME@ + " 安装向导";
    internal const string ServerDialogTitle = @NAME@ + " 授权服务器设置";
    internal const string UpdateTitle = @NAME@ + " 更新";
}
"""


def write_brand_cs(config, target):
    text = (BRAND_CS
            .replace("@NAME@", csharp(config["displayName"]))
            .replace("@COMPANY@", csharp(config["company"]))
            .replace("@COPYRIGHT@", csharp(config["copyright"]))
            .replace("@FOLDER@", csharp(config["installFolderName"]))
            .replace("@SLUG@", csharp(config["slug"])))
    target.write_text(text, encoding="utf-8")
    log("  品牌常量已写入 %s" % target)


def csharp(text):
    escaped = text.replace("\\", "\\\\").replace('"', '\\"')
    return '"%s"' % escaped


def verify_payload(zip_path, expected, dropped=()):
    """确认新 payload 里每个替换过的条目大小对得上、该删的条目确实没了。"""
    import zipfile
    with zipfile.ZipFile(zip_path) as archive:
        names = set(archive.namelist())
        if archive.testzip() is not None:
            raise SystemExit("payload 校验失败：压缩包内容损坏")
        for name, source in expected.items():
            if name not in names:
                raise SystemExit("payload 里缺少条目：%s" % name)
            info = archive.getinfo(name)
            want = pathlib.Path(source).stat().st_size
            if info.file_size != want:
                raise SystemExit("payload 条目 %s 大小不对：%d != %d" %
                                 (name, info.file_size, want))
            log("  校验 %-32s %s 字节" % (name, format(info.file_size, ",")))
        for name in dropped:
            if name in names:
                raise SystemExit("payload 里本该删掉的条目还在：%s" % name)
            log("  已删除 %s" % name)


def main(argv=None):
    parser = argparse.ArgumentParser(description="按品牌配置重新出客户端安装包")
    parser.add_argument("--config", default=str(HERE / "brand.json"))
    parser.add_argument("--root", default=str(DEFAULT_ROOT))
    parser.add_argument("--base", default=str(HERE / "base"))
    parser.add_argument("--build", default=str(HERE / "build"))
    parser.add_argument("--output", default=str(DEFAULT_OUT))
    parser.add_argument("--font", default=str(DEFAULT_FONT))
    parser.add_argument("--setup-name", default="")
    parser.add_argument("--no-pack", action="store_true", help="只生成素材，不拼安装包")
    parser.add_argument("--no-sync", action="store_true",
                        help="不动工作目录（测试用：不把结果同步回 stage，也不改 sfx\\Brand.cs）")
    parser.add_argument("--reset-base", action="store_true", help="重新抓一份未改品牌的基准素材")
    args = parser.parse_args(argv)

    started = time.time()
    config = load_config(args.config)
    root = pathlib.Path(args.root)
    base_dir = pathlib.Path(args.base)
    build = pathlib.Path(args.build)
    # Windows 文件名不区分大小写：videomix.exe 和 VideoMix.exe 放同一个目录会互相覆盖
    # （编启动器的时候会把 Electron 主程序顶掉），所以分开放。
    out_dir = build / "out"
    setup_dir = build / "setup"
    for folder in (build, out_dir, setup_dir):
        folder.mkdir(parents=True, exist_ok=True)
    images = build / "images"
    setup_name = args.setup_name or config["setupName"]
    # keepLogoImages=true：只换文字品牌，图标资源一律保留原版（客户还没给 logo 时用）
    keep_logo = bool(config.get("keepLogoImages"))

    log("品牌：%s（%s）  公司：%s" % (config["displayName"], config["nameEn"], config["company"]))

    log("")
    log("[1/8] 准备基准素材")
    base = ensure_base(root, base_dir, args.reset_base)

    log("")
    if keep_logo:
        log("[2/8] 跳过图标与 logo（keepLogoImages=true：保留原版图标，等拿到设计稿再换）")
    else:
        log("[2/8] 生成图标与 logo")
        run([PYTHON, str(HERE / "make_images.py"), "--config", args.config,
             "--out", str(images), "--font", args.font])

    log("")
    log("[3/8] 重建 app.asar")
    rules = build / "rules.json"
    run([PYTHON, str(HERE / "make_rules.py"), "--config", args.config,
         "--images", str(images), "--out", str(rules)])
    fresh_asar = out_dir / "app.asar"
    run([PYTHON, str(HERE / "build_asar.py"), "--base", str(base["app.asar"]),
         "--rules", str(rules), "--out", str(fresh_asar)])

    log("")
    log("[4/8] 改写 videomix.exe（图标 + 文件属性 + 完整性哈希）")
    fresh_exe = out_dir / "videomix.exe"
    shutil.copyfile(base["videomix.exe"], fresh_exe)
    run([PYTHON, str(HERE / "patch_integrity.py"), str(fresh_exe), str(fresh_asar)])
    exe_args = [PYTHON, str(HERE / "patch_exe.py"), "--exe", str(fresh_exe)]
    if not keep_logo:
        exe_args += ["--ico", str(images / "app.ico")]
    exe_args += ["--company", config["company"],
                 "--product", config["displayName"],
                 "--description", config["displayName"],
                 "--copyright", config["copyright"]]
    run(exe_args)

    log("")
    log("[5/8] 生成品牌常量与使用说明")
    brand_cs = root / "sfx" / "Brand.cs"
    previous_brand_cs = brand_cs.read_text(encoding="utf-8") if brand_cs.exists() else None
    write_brand_cs(config, root / "sfx" / "Brand.cs")
    usage = setup_dir / "使用说明.txt"
    usage.write_text(USAGE_TEMPLATE.format(
        name=config["displayName"],
        line="=" * (len(config["displayName"]) + 5),
        slug=config["slug"],
        folder=config["installFolderName"],
        main_exe="videomix.exe",
        display=config["displayName"],
        launcher="VideoMix.exe"), encoding="utf-8")
    log("  使用说明已写入 %s" % usage)
    if not keep_logo:
        shutil.copyfile(images / "app.ico", root / "stage" / "videomix" / "uninstallerIcon.ico")

    log("")
    log("[6/8] 编译安装程序")
    stub = setup_dir / "VideoMix.exe"
    run([PWSH, "-NoProfile", "-File", str(root / "build-launcher.ps1"), "-Out", str(stub)])

    log("")
    log("[7/8] 重打 payload")
    fresh_payload = build / "payload.zip"
    replacements = [
        ("videomix/resources/app.asar", fresh_asar),
        ("videomix/videomix.exe", fresh_exe),
    ]
    if not keep_logo:
        replacements.append(("videomix/uninstallerIcon.ico", images / "app.ico"))
    replacements += [("使用说明.txt", usage), ("VideoMix.exe", stub)]
    # 「Uninstall videomix.exe」是原版 Electron 自带的卸载器，图标还是旧旋涡，
    # 而且新客户端根本没有引用它（app-update.yml 指向已停用的仓库，main.js 里
    # 一处 Uninstall 都没有）。留在安装目录里只会让人以为"那个才是卸载程序"。
    drops = ["videomix/Uninstall videomix.exe"]
    payload_args = [PYTHON, str(HERE / "build_payload.py"),
                    "--base", str(base["payload.zip"]), "--out", str(fresh_payload)]
    for name, source in replacements:
        payload_args += ["--replace", "%s=%s" % (name, source)]
    for name in drops:
        payload_args += ["--drop", name]
    run(payload_args)
    verify_payload(fresh_payload, dict(replacements), drops)

    output_path = pathlib.Path(args.output) / setup_name
    output_path.parent.mkdir(parents=True, exist_ok=True)
    if args.no_pack:
        log("")
        log("[8/8] 跳过拼安装包（--no-pack）")
    else:
        log("")
        log("[8/8] 拼安装包")
        run([PWSH, "-NoProfile", "-File", str(root / "build-setup.ps1"),
             "-Stub", str(stub), "-Payload", str(fresh_payload),
             "-Output", str(output_path)])

    if args.no_sync:
        if previous_brand_cs is not None:
            brand_cs.write_text(previous_brand_cs, encoding="utf-8")
        log("")
        log("按 --no-sync 要求，工作目录保持原样（只出了新安装包）")
    else:
        log("")
        log("同步回工作目录（下次直接跑 build-launcher.ps1 也还是新品牌）")
        shutil.copyfile(fresh_asar, root / "stage" / "videomix" / "resources" / "app.asar")
        shutil.copyfile(fresh_exe, root / "stage" / "videomix" / "videomix.exe")
        shutil.copyfile(stub, root / "stage" / "VideoMix.exe")
        shutil.copyfile(stub, root / "sfx" / "VideoMix.exe")
        shutil.copyfile(usage, root / "stage" / "使用说明.txt")

    log("")
    log("完成，用时 %.1f 秒" % (time.time() - started))
    if not args.no_pack:
        log("安装包：%s" % output_path)
        log("  大小 %.1f MB    SHA256 %s" % (
            output_path.stat().st_size / 1048576, sha256(output_path)))
    return 0


if __name__ == "__main__":
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(errors="replace")
        except Exception:
            pass
    sys.exit(main())
