# 客户端构建清单

客户端来源为本地离线备份的原始运行基座。当前仓库只保存可审计的改造源码、皮肤、品牌素材和构建脚本。

构建环境：Windows + Python 3.12。

```powershell
cd 客户端/源码
python make_rules.py --config brand.json --images ..\品牌素材 --out build\rules.json
python build_asar.py --base <原始app.asar> --rules build\rules.json --out build\out\app.asar
python patch_integrity.py <videomix.exe> build\out\app.asar
```

构建后使用 `build_payload.py`、对应安装脚本和离线运行基座制作完整安装包。完整基座和成品安装包在离线备份中保存。
