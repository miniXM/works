# -*- coding: utf-8 -*-
"""按 brand.json 生成 build_asar.py 需要的替换规则。

用法：python make_rules.py --config brand.json --images <图片目录> --out rules.json
"""

import argparse
import json
import pathlib
import sys

import behaviour_rules
import gap_rules
import persona_rules
import persona_seed_rules
import ui_rules
import voice_rules

HERE = pathlib.Path(__file__).resolve().parent
SKIN_DIR = HERE / "skin"

# 皮肤注入点：整套 UI 皮肤 + 白天/暗黑主题脚本。
# 必须排在 index.html 里原有的 <link rel="stylesheet"> 之后，否则会被后加载的分页样式盖掉。
SKIN_ANCHOR = "</head>"
SKIN_SNIPPET = (
    '<link id="vm-skin" rel="stylesheet" href="./assets/vm-skin.css">\n'
    '    <script src="./assets/vm-theme.js"></script>\n'
    "  </head>"
)


def skin_rules(config):
    """UI 皮肤相关的规则；config 里设 "skipSkin": true 可以只出纯品牌包。"""
    if config.get("skipSkin"):
        return {"text": [], "add": {}}
    return {
        "text": [[SKIN_ANCHOR, SKIN_SNIPPET]],
        "add": {
            "dist/assets/vm-skin.css": str(SKIN_DIR / "vm-skin.css"),
            "dist/assets/vm-theme.js": str(SKIN_DIR / "vm-theme.js"),
        },
    }


def build(config, images_dir):
    name = config["name"]
    name_en = config.get("nameEn") or name
    text = [
        # 长的先替换，否则“混剪矩阵智能体”会被“混剪矩阵”拆掉
        ["混剪矩阵智能体", name + "智能体"],
        ["混剪矩阵", name],
        ["INNOVESSEL", name_en],
        # 左栏品牌名兜底值（代码里是反引号包起来的字面量，连引号一起换，避免误伤图片文件名）
        ["`创舰`", "`" + name + "`"],
    ]
    # 顶栏那颗版本胶囊和「系统设置 → 当前版本」的兜底值在原包里是写死的 1.1.2。
    # 反引号一起替换：asar 里同号的依赖版本号有十几处，只有模板字符串才是这两个页面在用的。
    asar_version = str(config.get("asarVersion") or "1.1.2")
    app_version = str(config.get("version") or "")
    if app_version and asar_version != app_version:
        text.append(["`" + asar_version + "`", "`" + app_version + "`"])
    # 客户端行为补丁：已激活的机器重开直接进主界面、退出登录清激活码、
    # 授权服务器连不上时不把人踢回激活页。
    text.extend([list(rule) for rule in behaviour_rules.RULES])
    # 客户看过界面之后提的界面微调（logo 大小、标题栏固定）
    text.extend([list(rule) for rule in ui_rules.RULES])
    # 镜头空档：没人说话的镜头按文案长度裁短，合成前再提醒一次
    text.extend([list(rule) for rule in gap_rules.RULES])
    # 账号档案：加「AI 帮我写」，问答式生成整份档案
    text.extend([list(rule) for rule in persona_rules.RULES])
    # 账号档案：默认给一份 XX 填空模板（含表单示例文字）
    text.extend([list(rule) for rule in persona_seed_rules.RULES])
    # 智能配音：没填 MiniMax Key 时，音色下拉要说明为什么不能选
    text.extend([list(rule) for rule in voice_rules.RULES])
    # UI 皮肤：整套界面重绘 + 白天/暗黑主题开关
    skin = skin_rules(config)
    text.extend([list(rule) for rule in skin["text"]])
    images = {
        "dist/app-icon.png": str(images_dir / "app-icon.png"),
        "dist/tray-icon.png": str(images_dir / "tray-icon.png"),
        "dist/favicon.png": str(images_dir / "favicon.png"),
        "dist/favicon.ico": str(images_dir / "app.ico"),
        "dist/favicon.svg": str(images_dir / "favicon.svg"),
        "dist/assets/创舰-CaezdxB6.png": str(images_dir / "mark.png"),
        "dist/assets/创舰1-bJwsFj2F.png": str(images_dir / "wordmark.png"),
    }
    if config.get("keepLogoImages"):
        # 只改文字、不动任何图标资源（客户还没给 logo 时用）
        images = {}
    return {"text": text, "images": images, "add": skin["add"]}


def main(argv=None):
    parser = argparse.ArgumentParser(description="生成 asar 替换规则")
    parser.add_argument("--config", required=True)
    parser.add_argument("--images", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args(argv)
    config = json.loads(pathlib.Path(args.config).read_text(encoding="utf-8"))
    rules = build(config, pathlib.Path(args.images))
    pathlib.Path(args.out).write_text(
        json.dumps(rules, ensure_ascii=False, indent=2), encoding="utf-8")
    print("  规则已写入 %s" % args.out)
    return 0


if __name__ == "__main__":
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(errors="replace")
        except Exception:
            pass
    sys.exit(main())
