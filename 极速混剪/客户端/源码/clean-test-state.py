# -*- coding: utf-8 -*-
"""清掉验证流程留在工作目录和 %APPDATA% 里的测试痕迹。

只动这几处，都是跑截图/端到端脚本时生成的：

    work\\rebrand\\shots\\app\\license-ticket.json   激活票据（会被真实激活覆盖）
    work\\rebrand\\shots\\app\\license-client.log    客户端代理日志
    %APPDATA%\\videomix\\Local Storage\\leveldb\\*   Chromium localStorage
    %APPDATA%\\videomix\\Session Storage\\*          会话存储

保留 license-server.json 与 backend\\，否则下次截图还得重新搭一遍环境。
"""

import os
import pathlib
import shutil
import sys

HERE = pathlib.Path(__file__).resolve().parent
SHOT_DIR = HERE / "shots" / "app"
APPDATA = pathlib.Path(os.environ.get("APPDATA", "")) / "videomix"


def remove_file(path):
    if path.exists():
        path.unlink()
        print("  删除文件 %s" % path)


def remove_dir(path):
    if path.exists():
        shutil.rmtree(path)
        print("  删除目录 %s" % path)


def main():
    print("清理截图目录的测试痕迹")
    remove_file(SHOT_DIR / "license-ticket.json")
    remove_file(SHOT_DIR / "license-client.log")

    print("清理 Chromium 本地存储")
    remove_dir(APPDATA / "Local Storage")
    remove_dir(APPDATA / "Session Storage")
    print("完成（截图脚本下次会重新激活并生成新的票据）")
    return 0


if __name__ == "__main__":
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(errors="replace")
        except Exception:
            pass
    sys.exit(main())
