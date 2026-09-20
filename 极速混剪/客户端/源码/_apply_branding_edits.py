# -*- coding: utf-8 -*-
"""一次性脚本：把启动器源码里的写死文案换成 Brand.Xxx 常量。

跑过一次之后，这里的每条规则都会命中 0 次（那时会提示“已经是改过的”），
所以重复运行是安全的。
"""

import pathlib
import sys

SFX = pathlib.Path(r"E:\GPT Codex\2026-09-15\new-chat\work\videomix-rebuild\sfx")

RULES = {
    "VideoMix.cs": [
        ('Environment.SpecialFolder.LocalApplicationData), "VideoMix");',
         'Environment.SpecialFolder.LocalApplicationData), Brand.InstallFolderName);'),
        ('Text = "VideoMix 安装程序";', 'Text = Brand.InstallerTitle;'),
        ('title.Text = "VideoMix 安装向导";', 'title.Text = Brand.WizardTitle;'),
        ('dialog.Description = "选择 VideoMix 安装目录";',
         'dialog.Description = "选择 " + Brand.ShortName + " 安装目录";'),
        ('"请填写安装目录。", "VideoMix", MessageBoxButtons.OK, MessageBoxIcon.Warning',
         '"请填写安装目录。", Brand.ShortName, MessageBoxButtons.OK, MessageBoxIcon.Warning'),
        ('"VideoMix", MessageBoxButtons.YesNo, MessageBoxIcon.Warning);',
         'Brand.ShortName, MessageBoxButtons.YesNo, MessageBoxIcon.Warning);'),
        ('"VideoMix 已安装到：\\r\\n"', 'Brand.ShortName + " 已安装到：\\r\\n"'),
        ('Path.Combine(settings.InstallDir, "VideoMix.exe")',
         'Path.Combine(settings.InstallDir, Brand.LauncherExeName)'),
        ('"日志：" + logPath, "VideoMix", MessageBoxButtons.OK, MessageBoxIcon.Error',
         '"日志：" + logPath, Brand.ShortName, MessageBoxButtons.OK, MessageBoxIcon.Error'),
        ('Path.Combine(target, "VideoMix.exe")',
         'Path.Combine(target, Brand.LauncherExeName)'),
        ('Environment.SpecialFolder.DesktopDirectory), "VideoMix.lnk");',
         'Environment.SpecialFolder.DesktopDirectory), Brand.ShortcutFileName);'),
        ('return Path.Combine(programs, "VideoMix.lnk");',
         'return Path.Combine(programs, Brand.ShortcutFileName);'),
        ('new object[] { "VideoMix 混剪矩阵" }', 'new object[] { Brand.Name }'),
        (r'CreateSubKey(@"Software\Microsoft\Windows\CurrentVersion\Uninstall\VideoMix")',
         'CreateSubKey(Brand.UninstallKeyPath)'),
        (r'DeleteSubKeyTree(@"Software\Microsoft\Windows\CurrentVersion\Uninstall\VideoMix", false)',
         'DeleteSubKeyTree(Brand.UninstallKeyPath, false)'),
        ('key.SetValue("DisplayName", "VideoMix 混剪矩阵");',
         'key.SetValue("DisplayName", Brand.Name);'),
        ('key.SetValue("Publisher", "VideoMix");',
         'key.SetValue("Publisher", Brand.Publisher);'),
        ('Path.Combine(dir, App.AppFolderName, "videomix.exe")',
         'Path.Combine(dir, App.AppFolderName, Brand.MainExeName)'),
        ('" 找到 VideoMix 主程序。\\r\\n请重新运行安装程序。", "VideoMix",',
         '" 找到 " + Brand.Name + " 主程序。\\r\\n请重新运行安装程序。", Brand.ShortName,'),
        ('"启动失败：" + ex.Message, "VideoMix"',
         '"启动失败：" + ex.Message, Brand.ShortName'),
        ('form.Text = "VideoMix 授权服务器设置";', 'form.Text = Brand.ServerDialogTitle;'),
        ('MessageBox.Show(form, reason, "VideoMix", MessageBoxButtons.OK, MessageBoxIcon.Warning);',
         'MessageBox.Show(form, reason, Brand.ShortName, MessageBoxButtons.OK, MessageBoxIcon.Warning);'),
        ('request.UserAgent = "VideoMixLauncher";', 'request.UserAgent = Brand.UserAgent;'),
        ('"确定要卸载 VideoMix 吗？\\r\\n\\r\\n安装目录："',
         '"确定要卸载 " + Brand.Name + " 吗？\\r\\n\\r\\n安装目录："'),
        ('"卸载 VideoMix", MessageBoxButtons.YesNo', '"卸载 " + Brand.Name, MessageBoxButtons.YesNo'),
    ],
    "Updater.cs": [
        ('"VideoMix", "updates");', 'Brand.InstallFolderName, "updates");'),
        ('"VideoMix 有新版本 v"', 'Brand.ShortName + " 有新版本 v"'),
        ('"VideoMix 更新"', 'Brand.UpdateTitle'),
        ('Path.Combine(payloadDir, "VideoMix.exe")',
         'Path.Combine(payloadDir, Brand.LauncherExeName)'),
        ('"VideoMixLauncher/" + CurrentVersion', 'Brand.UserAgent + "/" + CurrentVersion'),
    ],
}


def main():
    total = 0
    for name, rules in RULES.items():
        path = SFX / name
        text = path.read_text(encoding="utf-8")
        for old, new in rules:
            hits = text.count(old)
            if hits == 0:
                print("  跳过（没找到，可能已经改过）：%s" % old[:50])
                continue
            text = text.replace(old, new)
            print("  %s ×%d  %s" % (name, hits, old[:46]))
            total += hits
        path.write_text(text, encoding="utf-8")
    print("共替换 %d 处" % total)
    return 0


if __name__ == "__main__":
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(errors="replace")
        except Exception:
            pass
    sys.exit(main())
