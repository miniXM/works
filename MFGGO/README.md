# MFGGO 智造云本地版

这是一个面向机加工团队的可运行多租户工作台。当前已接通 SQLite 持久化和组织隔离，覆盖平台主后台、企业/租户、企业功能模块、成员与角色、项目、零件、报价/BOM、FAIR 检验、任务、项目沟通、企业聊天、统计和操作审计；套餐、计费与价格策略暂不实现。

平台后台与企业工作台是两层独立导航：平台管理员负责“全部企业”，企业用户只看到当前企业已开通的功能模块。每个企业可以独立启用或关闭制表中心、零件中心、沟通、聊天、任务和统计等模块。

## 启动

```powershell
pnpm install
pnpm run build
pnpm run server
```

生产预览地址：`http://<本机局域网IP>:4310/`

开发时执行一个命令即可同时启动 API 和 Vite 前端：

```powershell
pnpm run dev
```

需要分别调试时，可使用 `pnpm run dev:server` 和 `pnpm run dev:web`。这两个命令都默认监听 `0.0.0.0`，所以同一局域网内其他设备也能访问。

登录账号：`admin` / `123456`。

## 聊天服务如何投入使用

聊天不再是页面内的示例数据：会话、消息、未读状态和附件都会写入当前企业的 SQLite 数据库。实际使用时按下面的顺序配置即可：

1. 用企业所有者账号进入“企业管理”，邀请需要协作的成员；企业频道对当前企业所有成员开放。
2. 在“聊天信息”点“＋ 新建”，创建有业务名称的企业频道，例如“生产排期协同”；再在频道内发送文字或附件。
3. 需要限定到项目的讨论，先创建项目并将成员加入项目，再在“项目沟通”发起主题并收发文字或附件。项目成员之外的账号不能查看、发送或下载该项目会话附件。
4. 页面保持打开时会自动同步会话摘要和当前打开的讨论；未读、@我的和稍后处理均按当前账号独立保存。附件单条最多 50 MB、每条消息最多 5 个，支持图纸、Office、PDF、图片和压缩包等界面列出的格式。

运行维护要点：

- 用 `pnpm run build` 后再执行 `pnpm run server`，不要只启动静态前端；聊天 API、SQLite 和附件存储都由后端提供。
- 健康检查：`Invoke-WebRequest -UseBasicParsing http://<本机局域网IP>:4310/api/health`。
- 备份时要成对保存数据库（`DB_PATH`）和附件目录（`CHAT_ATTACHMENT_STORAGE_DIR`；本地默认是 `data/chat-attachments/`）；仅备份数据库会丢失已发送附件的实体文件。
- 公网部署应把附件目录换成受备份、限额和病毒扫描保护的对象存储，并为待发送但未引用的附件设置定时清理任务。

本地开发（`pnpm run dev`）使用 Vite 入口：

- 前端统一端口：`7410`
- API 统一端口：`4310`
- 企业工作台：`http://<本机局域网IP>:7410/enterprise.html`
- Admin 平台主后台：`http://<本机局域网IP>:7410/admin.html`

本地开发和人工验收只使用 `7410` 前端端口。`pnpm run dev` 会同时启动 API `4310` 与 Vite 前端 `7410`；单独启动前端时使用 `pnpm run dev:web`。

构建后以 `pnpm run server` 提供服务时，使用同样的路径但端口为 `4310`。根地址是统一登录页；登录后按账号权限进入对应工作台。

## 制表中心

“制表中心”是 CAD/PDF 项目清单导入入口：选择项目后上传 STEP、STP、IGES、BREP、PDF 或 ZIP，3D 零件在浏览器本地解析后会自动生成 BOM、制造数据和报价基础，并同步到对应项目根任务的“项目清单”与“关联内容”；2D 图纸直接进入气泡标注与 FAIR 检验流程。原 ONLYOFFICE 文档服务接口保留用于历史数据兼容，不再作为制表中心首页。

服务端至少需要配置：

```bash
PUBLIC_BASE_URL=https://your-host.example/api
ONLYOFFICE_JWT_SECRET=replace-with-your-documentserver-secret
```

当前 ONLYOFFICE 9.4 镜像需要执行 `scripts/patch-onlyoffice-container.sh`，以补齐兼容脚本并刷新编辑器资源版本。Linux 服务器可安装 `scripts/mfggo-onlyoffice-patch.service`，在 Docker 启动后自动应用该补丁。

平台主后台只负责全部企业、平台用户、平台审计和系统设置；企业工作台只显示当前企业已启用的模块。平台管理员在企业管理中关闭“制表中心”或“零件中心”后，切换/进入该企业即可看到对应导航项消失。

## 功能验收流程

1. 登录后进入“项目管理”，查看按业务阶段排列的项目看板；点击项目卡会直接打开该项目唯一根任务的详情弹窗。
2. 在任务详情中编辑任务字段、执行者、时间、优先级和备注，并查看参与者、动态和评论。
3. 点击“新建项目”，输入项目名；项目与其根任务会通过 Koa API 写入 SQLite 并出现在看板中。
4. 进入“零件中心”，点击“新增”，选择项目并保存零件；刷新后零件仍会保留。
5. 进入“制表中心”，选择项目并上传 STEP、PDF 或项目 ZIP；确认 CAD 在本地生成 B-Rep 制造数据与报价基础，PDF 可进入气泡标注和 FAIR 导出。
6. 点击“管理 FAIR”，新增检验特性、名义值、公差并关联零件；保存后卡片会显示待复核数量。
7. 刷新页面，登录会在当前浏览器会话内自动恢复，报价与 FAIR 数据也会从 SQLite 重新加载。
8. 点击右上角企业名称查看当前企业成员与角色；点击“打开完整工作台”进入原有 CAD、图纸气泡标注与 FAIR 工作台。
9. 切换到“平台主后台”，在“企业管理”中新建企业、配置模块，或进入另一企业空间；“平台审计”可查看跨企业操作记录。
10. 在企业菜单中邀请成员、修改成员角色；在“我的任务”创建或导入独立通用任务（项目卡只保留唯一根任务，不再创建项目子任务），在“聊天信息”发送企业会话消息，在“统计”查看当前企业实时汇总。
11. 调用 `/api/audit`，确认登录、项目、零件、报价、FAIR、任务和成员操作均有审计记录。

报价与 FAIR API：

- `GET/POST /api/projects/:projectId/quotes`
- `GET/POST /api/projects/:projectId/members`
- `GET /api/projects/:projectId/quotes/:quoteId`
- `GET/POST /api/projects/:projectId/fair-items`
- `PUT /api/projects/:projectId`
- `PUT /api/projects/:projectId/quotes/:quoteId`
- `PUT /api/projects/:projectId/fair-items/:itemId`
- `PUT /api/parts/:partId`
- `GET/POST /api/tasks`
- `GET /api/tasks/:taskId/detail`
- `POST /api/tasks/:taskId/comments`
- `PUT /api/tasks/:taskId`
- `GET/POST /api/conversations`
- `GET/POST /api/conversations/:conversationId/messages`
- `GET/PUT /api/members/:userId/role`
- `POST /api/members`
- `GET /api/stats`
- `GET /api/platform/organizations`
- `POST /api/platform/organizations`
- `PUT /api/platform/organizations/:organizationId/modules`
- `POST /api/platform/organizations/:organizationId/switch`
- `GET /api/platform/audit`

报价草稿保存 BOM 明细、数量、单价（分）和小计；FAIR 保存检验特性、名义值、公差和状态。业务 API 按明确授权、模块开关和项目成员关系校验。企业身份为主管理 `owner`、副管理 `admin`、员工 `member`；工程师、质检员是职位，不赋予权限。主管理在“组织架构”管理部门、员工及副管理授权范围；副管理需获得员工/部门管理能力，并只能在允许范围内授予员工业务权限，不能修改本人或其他管理者。创建任务不自动授予管理权限，任务修改仍由当前执行者负责。

右上角个人菜单可编辑企业内姓名、部门和职位，或切换本人已加入的企业。平台主管理通过该菜单的“平台管理员”任命副管理并逐项授权；新建企业必须选择企业主管理账号，平台操作者不会自动获得企业所有权。平台管理身份和企业身份分别保存，跨企业业务读取仍要求有效成员关系。

## 独立公网部署（端口 8320）

该部署直接监听 `0.0.0.0:8320`，不修改 CloudChat 的 Nginx 配置、`80/443` 端口、现有 `4310` 服务或原数据库。服务器目录和数据目录分别使用 `/opt/zhizao-cloud` 与 `/var/lib/zhizao-cloud`。

```bash
sudo useradd --system --home /opt/zhizao-cloud --shell /usr/sbin/nologin zhizao-cloud
sudo mkdir -p /opt/zhizao-cloud /var/lib/zhizao-cloud/office-documents /var/lib/zhizao-cloud/chat-attachments /etc/zhizao-cloud
sudo chown -R zhizao-cloud:zhizao-cloud /opt/zhizao-cloud /var/lib/zhizao-cloud

# 将项目发布到 /opt/zhizao-cloud 后执行
cd /opt/zhizao-cloud
pnpm install --frozen-lockfile
pnpm run build
sudo cp deploy/zhizao-cloud.env.example /etc/zhizao-cloud/zhizao-cloud.env
sudo cp deploy/zhizao-cloud.service /etc/systemd/system/zhizao-cloud.service
sudo chmod 600 /etc/zhizao-cloud/zhizao-cloud.env
```

启动前必须修改 `/etc/zhizao-cloud/zhizao-cloud.env` 中的管理员密码和 JWT 密钥。然后启动独立服务：

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now zhizao-cloud
curl http://127.0.0.1:8320/api/health
```

同时需要在云服务器安全组和系统防火墙中仅开放 TCP `8320`。访问入口：

- 企业工作台：`http://43.139.7.28:8320/enterprise.html`
- Admin 平台：`http://43.139.7.28:8320/admin.html`

ONLYOFFICE 模板使用独立的 `8081`，不会复用或改动 CloudChat 当前的 `8080` 实例；部署独立 DocumentServer 前，在线编辑器暂不可用，其他项目功能不受影响。直接 IP 访问是明文 HTTP，不适合传输正式客户图纸、报价或其他敏感资料；正式使用应再增加 VPN、IP 白名单或独立 HTTPS 入口。

## 数据与上线边界

- SQLite 数据默认写入 `data/machquote.sqlite`，可通过 `DB_PATH` 覆盖。
- 每个业务表带 `organization_id`，API 查询和写入按当前登录企业隔离。
- STEP/PDF 解析继续优先在浏览器本地执行；后续只上传解析结果、预览或明确授权的文件。
- 当前登录适合本地部署和内部验收；公网生产使用前需要接入正式密码策略、邀请注册、刷新令牌、CSRF、限流和对象存储。
- 报价定价、订阅、账单和支付不在本阶段范围内。
