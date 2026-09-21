# 极速 VideoMix 双平台客户端

此目录是 Windows 与 macOS 共用的 Electron 客户端。`renderer/` 是从已验证 Windows 1.0.3/1.1.2 界面包固定下来的兼容界面，`electron/` 和 `backend/` 是新的可维护跨平台运行层。

## 本地验证

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm start
```

## 构建

- Windows x64: `npm run build:win`
- macOS arm64/x64: 在 macOS 上运行 `npm run build:mac`
- 正式 macOS 包通过仓库根目录 `.github/workflows/jisu-videomix-release.yml` 在 macOS runner 上构建、Developer ID 签名并公证；没有证书 secrets 时，Actions 会生成带 `unsigned-test` 标记的测试包。

正式发布需要仓库 secrets：`MAC_CERT_P12_BASE64`、`MAC_CERT_PASSWORD`、`APPLE_ID`、`APPLE_APP_SPECIFIC_PASSWORD`、`APPLE_TEAM_ID`。缺少这些凭据时只能生成未签名测试包，不能通过 Gatekeeper 正式分发。
