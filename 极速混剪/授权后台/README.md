# VideoMix 授权中心（PHP + MySQL 版）

网页版授权后台。**宝塔建一个 PHP 站点就能跑**，激活码、批次、一级/二级代理、
设备绑定、操作日志全部存在 MySQL 表里。

## 部署

看 [`部署-宝塔PHP版.md`](部署-宝塔PHP版.md)，从「上传代码」开始一步步跟着做。

最短路径：

1. 整个目录传到 `/www/wwwroot/videomix-license`
2. 宝塔新建站点（PHP 8.x）+ 新建 MySQL 库
3. 网站运行目录改成 `public`
4. nginx 伪静态加 `location / { try_files $uri $uri/ /index.php?$query_string; }`
5. 浏览器打开 `https://你的域名/install.php` 填数据库和总账号
6. 登录后台 → 设置 → 客户端授权地址 → 填 `https://你的域名`

## 目录说明

| 路径 | 作用 |
| --- | --- |
| `public/index.php` | 唯一入口：网页、管理接口、客户端接口全走这里 |
| `public/install.php` | 网页安装向导：新建安装 / **用备份文件恢复**（迁移） |
| `public/web/` | 后台前端（`pc.html` 电脑版 / `m.html` 手机版） |
| `lib/` | PHP 源码：加密、数据库、业务逻辑、备份（`Backup.php`） |
| `sql/schema.sql` | MySQL 建表脚本 |
| `keys/license-private.xml` | 授权签名私钥（**保密**，指纹 `f95b88ffbe6bd54e`） |
| `data/updates/` | 客户端更新包目录（需可写） |
| `data/backups/` | 数据库备份目录（后台「数据备份」写这里，需可写） |
| `config.sample.php` | 配置样例（正常情况下不用手改） |
| `nginx-示例.conf` | 宝塔 nginx 站点配置参考 |

## 备份与迁移

后台左侧 **数据备份** 页：

- **立即备份**：整库导成 `data/backups/videomix-backup-日期时间.sql`（纯 SQL，含建表 + 数据）
- **下载**：存到本地
- **恢复**：把备份导回当前数据库（覆盖前会自动另存一份当前数据）
- **上传备份 / 删除**：把别处导出的 `.sql` 传上来，或清掉旧文件

换服务器：旧站备份并下载 → 新服务器部署后访问 `/install.php` →
「安装方式」选 **用备份文件恢复** → 上传 `.sql` → 用原账号密码登录。
私钥指纹不变，已发出去的客户端不用重装。

## 从旧版（Python + SQLite）搬数据

只有「旧后台已经发过激活码」才需要这一步，没发过就直接删旧程序。

把旧服务器的 `/www/wwwroot/videomix-license/data/license.db` 下载下来，
新后台 → **数据备份 → 从旧版导入** → 选中它 → 点「导入 license.db」。
不用命令行、不用转换（需要 PHP 开了 `pdo_sqlite`，宝塔默认有）。

导入只补不覆盖：重名的账号和重复的激活码自动跳过；
总账号密码、签名私钥、授权地址不受影响。新建的代理商账号会拿到随机密码。

旧后台还能打开时，也可以访问 `/api/export` 存 JSON，用同一个页面的「导入 JSON」入口；
只有数据库文件、又不想开扩展时，用 `tools/旧库转JSON.py` 把它转成 JSON。

删除旧服务的步骤写在 [`部署-宝塔PHP版.md`](部署-宝塔PHP版.md) 第 15 节。

## 接口一览

客户端用（无需登录）：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/health` | 存活检查 |
| POST | `/rpc/authActivateCode` | 激活 `{activateCode, deviceId, category}` |
| POST | `/rpc/judgeActivateCode` | 校验 |
| GET | `/api/client-config` | 拉取最新授权服务器地址 |
| GET | `/api/client-version` | 检查客户端新版本 |
| GET | `/api/client-download` | 下载更新包 |

管理后台用：`/api/login` `/api/logout` `/api/me` `/api/overview`
`/api/agents` `/api/batches` `/api/codes` `/api/records` `/api/logs`
`/api/password` `/api/export` `/api/settings/...`

备份用（仅总账号）：`GET|POST /api/backups` · `GET /api/backups/{name}/download`
· `POST /api/backups/{name}/restore` · `POST /api/backups/upload` · `DELETE /api/backups/{name}`

返回结构和老版本（Python 版）逐字段一致，所以后台前端和客户端都不用改。

## 环境要求

- PHP 7.4 ~ 8.3（推荐 8.0+），扩展：`pdo_mysql`、`openssl`（可选 `mbstring`、`gmp`）
- MySQL 5.7+ / MariaDB 10.2+
- 不需要 Composer，不依赖任何第三方库

## 自测

```bash
# 语法检查
php -l lib/License.php

# 授权票据是否和客户端兼容（应输出 ALL OK）
php ../work/php-test/make-ticket.php keys/license-private.xml > /tmp/out.json
python3 ../work/php-test/verify-ticket.py /tmp/out.json
```
