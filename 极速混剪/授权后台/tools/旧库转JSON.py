# -*- coding: utf-8 -*-
"""把旧版（Python + SQLite）的 license.db 转成新后台能导入的 JSON。

用法（Windows / Linux 都行，只需要系统自带 Python）：

    python 旧库转JSON.py license.db 导出.json

然后在浏览器打开新后台 → 数据备份 → 「从旧版导入」，把 导出.json 传上去即可。

说明：
  - 只读，不会改动你的 license.db
  - 导出的结构和旧后台 /api/export 完全一样（users / batches / codes / devices）
  - 账号里不含密码（旧库里的密码是加盐哈希，导过去也没用）；
    新后台导入时会自动给新建的代理商账号生成随机密码，并在结果里列出来
"""
import json
import os
import sqlite3
import sys
from datetime import datetime, timezone


def rows(con, table):
    try:
        cur = con.execute('SELECT * FROM "%s"' % table)
    except sqlite3.OperationalError:
        return []
    return [dict(row) for row in cur.fetchall()]


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    src = sys.argv[1]
    dst = sys.argv[2] if len(sys.argv) > 2 else os.path.splitext(src)[0] + "-export.json"
    if not os.path.isfile(src):
        print("找不到文件：%s" % src)
        return 1

    con = sqlite3.connect(src)
    con.row_factory = sqlite3.Row
    users = rows(con, "users")
    for user in users:
        user.pop("password", None)
    payload = {
        "version": "legacy-sqlite",
        "exportedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "from": os.path.abspath(src),
        "users": users,
        "batches": rows(con, "batches"),
        "codes": rows(con, "codes"),
        "devices": rows(con, "devices"),
    }
    con.close()

    with open(dst, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2)

    bound = len(payload["devices"])
    print("已导出：%s" % dst)
    print("  账号 %d（含总账号 %d）· 批次 %d · 激活码 %d · 绑定设备 %d" % (
        len(payload["users"]),
        sum(1 for u in payload["users"] if u.get("role") == "master"),
        len(payload["batches"]),
        len(payload["codes"]),
        bound,
    ))
    print("接下来：新后台 → 数据备份 → 「从旧版导入」→ 选这个 json")
    return 0


if __name__ == "__main__":
    sys.exit(main())
