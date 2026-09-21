# Implementation Plan Index

当前计划：

- `2026-09-21-phase-1a-source-recovery-windows-baseline.md`：资产固化、ASAR 安全恢复、源码证据审计和 Windows 基线重建。

下一阶段根据 `recovery/source-provenance.json` 选择：

```text
import-original-source -> Phase 1B source import and normalization
clean-room-reconstruction -> Phase 1B Electron/Vue and Python contract reconstruction
```

当前选择：`clean-room-reconstruction`。原因是现有证据没有找到原始 Vue/Electron 源码或处理后端源码；ASAR 中只有打包产物，Windows 后端只有编译后的 `KrLongAI.exe` 及第三方运行时。

在 Phase 1B 生成可维护、可构建的 Windows 客户端之前，不开始授权代理迁移或 macOS 功能后端实现。
