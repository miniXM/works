# 极速混剪

本目录是“极速混剪”在 `miniXM/works` 中的独立迁移项目。它包含可继续维护所需的 PHP 授权后台源码、客户端改造规则、UI 皮肤、品牌素材、构建脚本、部署文档及当前客户端更新包。

## 目录

- `授权后台/`：PHP + MySQL 授权后台；上传到宝塔后访问 `public/install.php` 安装。
- `客户端/源码/`：基于原客户端 `app.asar` 的品牌、授权、界面、配音和更新逻辑补丁与构建脚本。
- `客户端/源码/双平台/`：可维护的 Electron + Vue Windows/macOS 共用客户端；通过 GitHub Actions 生成 Windows x64、macOS Intel x64 和 macOS arm64 安装包。
- `客户端/品牌素材/`：当前图标、字标和生成素材。
- `客户端/更新包/`：当前 `1.0.3` 增量更新包。
- `文档/`：客户端发布、密钥轮换、品牌素材说明。

## 迁移顺序

1. 部署 `授权后台/`，按 [`授权后台/部署-宝塔PHP版.md`](授权后台/部署-宝塔PHP版.md) 完成安装。
2. 把 `客户端/更新包/update-client-1.0.3.zip` 上传到授权后台的 `data/updates/`。
3. 用 `客户端/源码/brand.json`、规则脚本和 `skin/` 继续构建客户端；构建原始运行基座请从本机离线备份恢复。

## 双平台 GitHub Actions 发布

工作流位于仓库根目录 `.github/workflows/jisu-videomix-release.yml`，默认从 `极速混剪/客户端/源码/双平台/` 构建。推送 `v*` 标签会：

1. 在 Windows、macOS Intel 和 macOS Apple Silicon runner 上分别运行测试；
2. 构建 Windows x64 NSIS 安装包，以及 macOS x64/arm64 的 DMG 与 ZIP；
3. 若配置 `MAC_CERT_P12_BASE64`、`MAC_CERT_PASSWORD`、`APPLE_ID`、`APPLE_APP_SPECIFIC_PASSWORD`、`APPLE_TEAM_ID`，执行 Developer ID 签名、公证和 stapling 校验；
4. 将三平台产物上传为 GitHub Actions artifacts，并在标签构建时附加到 GitHub Release。

缺少 Apple secrets 时，macOS job 仍会生成文件名带 `unsigned-test` 的测试包；该包不具备 Gatekeeper 正式分发资格。Windows 代码签名如需启用，可在 workflow 中补充 Windows 证书或云签名配置。

## 未提交到公开仓库的文件

为保护授权体系与避免 GitHub 100 MB 单文件限制，以下文件保留在原电脑/离线备份中，不会上传：

- 授权私钥、数据库配置、数据库备份、激活码和客户数据；
- 完整安装包 `JSVideoMix-Setup-*.exe`、原始运行基座与其他大于 100 MB 的二进制文件；
- 本机日志、缓存、临时测试数据。

迁移时应把它们放在加密离线盘，不要提交到 GitHub。
