# Windows Baseline Results

日期：2026-09-21

## 已通过

- Reference manifest：3/3 文件 SHA-256 和大小匹配。
- ASAR：9,109 个条目，完整性失败 0 个。
- ASAR 重建：输出 SHA-256 `57E9A9E41C9A90F5EB4273F5E5DD947D795B43141E989B1BD941A2E62241F9C5`，与参考一致。
- Payload 重建：两次独立输出 SHA-256 均为 `4EBA3115E17251BC985D21E6CDABD75C4C9FEEB57712AFDC7624B406A2E0BA22`。
- 恢复测试：19/19 通过。
- Smoke 根目录安全测试：通过。
- 独立启动 `KrLongAI.exe` 观察 5 秒：进程保持运行，随后由本次测试 PID 停止。

## 当前阻塞

完整窗口 smoke 未完成。外层 Windows 启动器固定使用 `127.0.0.1:8081`，该端口当前由正在运行的预览客户端占用：

```text
Process: VideoMix.exe
PID: 11136
Path: E:\GPT-Codex\2026-09-21\JISU video mix\work\preview-install\VideoMix.exe
Port: 127.0.0.1:8081
```

为了不终止用户当前客户端，smoke 脚本在复制和启动前主动拒绝，报告 `Authorization port 8081 is occupied by a foreign process.`。关闭当前预览客户端后，重新执行：

```powershell
pwsh -NoProfile -File scripts/smoke-windows-baseline.ps1 `
  -BuildManifest recovery-output/baseline/build-manifest.json
```

脚本会复制完整隔离安装目录、启动外层 `VideoMix.exe`、等待隔离目录中的 Electron 窗口，再启动并检查隔离副本的后端；结束时只停止本次 PID。

## 结论

Phase 1A 的资产校验、ASAR/安装包确定性重建、源码证据审计和安全门禁已完成。窗口 smoke 需要在 8081 空闲时补跑；在此之前不得把 Windows 基线称为“端到端 smoke 全通过”。
