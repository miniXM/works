# 恢复资产规则

恢复工作使用以下四种资产分类：

- `reference`：由 SHA-256 校验且不可原地编辑的本机二进制参考文件。
- `generated`：可由 reference 或 source 输入重新产生的临时输出。
- `source`：由人维护并纳入 Git 的文本源码、测试、脚本和文档。
- `secret`：证书、凭据、激活状态或票据，不提交，也不在持续集成日志中打印。

## 操作规则

1. 构建前先校验所有 reference 文件。
2. 构建和测试只写入 `recovery-output` 或系统临时目录。
3. 不把提取后的压缩或混淆代码称为原始源码。
4. 不覆盖 `最新发布`、`work/rebrand/base` 或 `work/preview-install` 中的文件。
5. 测试日志不得包含完整激活码、票据、私钥或用户素材内容。
