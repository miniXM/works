# miniXM works

这是 miniXM 的独立项目集合。每个项目都使用自己的顶层目录，项目之间不共享运行时配置、依赖目录或生成数据。

## 当前项目

| 目录 | 用途 | 项目性质 |
| --- | --- | --- |
| [`MFGGO/`](./MFGGO/) | 制造业协同、报价、BOM、文档和工作区应用 | 独立应用项目 |
| [`miniXMapi/`](./miniXMapi/) | LLM、图片和视频工具融合 API 网关 | 独立服务项目 |

## 放置规则

新增项目必须放在仓库根目录下的独立文件夹中，例如：

```text
works/
├── MFGGO/
├── miniXMapi/
└── another-project/
```

每个项目目录至少应包含自己的：

- `README.md`：项目用途、启动方式、环境变量和当前状态。
- `package.json` 或对应的构建清单。
- `test/` 或项目自己的验证目录。
- `.gitignore`：忽略依赖、构建产物、运行数据和本地密钥。

项目内部的源码、测试、部署文件和文档都放在该项目目录下。不要把新项目的源码、`package.json`、README 或运行配置直接放到仓库根目录，也不要把一个项目的 `node_modules`、`dist`、`.env` 或数据库文件提交到仓库。

## 提交方式

在项目目录中完成开发和验证，再从仓库根目录提交：

```powershell
cd C:\path\to\works
git add miniXMapi/
git commit -m "describe the project change"
git push origin main
```

提交前至少运行该项目 README 中列出的类型检查、测试和构建命令。跨项目改动需要在提交说明中写明受影响的项目。

## 安全边界

API Key、供应商密钥、客户数据、上传文件、生成媒体和本地数据库只保留在部署环境或本地忽略目录中。仓库只提交代码、测试、文档和不含密钥的示例配置。
