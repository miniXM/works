# macOS 版本构建状态

日期：2026-09-21

## 已完成

- 新的共享 Electron + Vue 客户端工程位于 `client/`。
- macOS 与 Windows 共用同一份 renderer、preload 和主进程业务接口。
- macOS 使用 `darwin` 稳定系统 UUID 派生 `vm-device-v2:darwin:<sha256>` 设备 ID；不上传原始 UUID。
- 授权代理迁入 Electron 主进程，继续监听 `127.0.0.1:8081`，授权协议保持 `/rpc/authActivateCode`、`/rpc/judgeActivateCode`。
- 本地合成服务监听 `127.0.0.1:35006`，调用随包的 FFmpeg，支持视频时间轴、背景音频和配音混音。
- 已将设备不匹配文案固定为：`当前激活码与设备不匹配，请重新输入`。
- electron-builder 已声明 Windows x64、macOS Intel x64、macOS Apple Silicon arm64 三类产物。
- GitHub Actions 已配置 Windows 构建、macOS 双架构构建、签名、公证和 stapling 验证。

## 当前验证结果

- 客户端 Node 测试：6/6 通过。
- FFmpeg 真实两段视频拼接冒烟：通过，输出可被 FFmpeg 重新读取。
- 当前 Windows 机器无法生成 macOS 安装包：electron-builder 明确要求在 macOS 上构建 macOS 目标。
- 当前机器没有 Apple Developer 证书和公证凭据，因此不能在本机产生可通过 Gatekeeper 的正式包。

## 发布入口

在配置 `MAC_CERT_P12_BASE64`、`MAC_CERT_PASSWORD`、`APPLE_ID`、`APPLE_APP_SPECIFIC_PASSWORD`、`APPLE_TEAM_ID` 后，推送 `v*` 标签或手动运行 `.github/workflows/desktop-release.yml`。macOS runner 会生成 DMG/ZIP；Windows runner 会同步生成 NSIS 安装包。

## 不影响现有 Windows 版本的保证

旧版安装包、ASAR 和 `KrLongAI.exe` 均未修改。新工程只位于 `client/`，旧 Windows 基线继续由 `scripts/build-windows-baseline.ps1` 管理。
