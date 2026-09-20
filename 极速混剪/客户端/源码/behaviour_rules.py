# -*- coding: utf-8 -*-
"""客户端行为补丁（在 app.asar 的 dist/assets/*.js 里做定点字符串替换）。

确认过的产品行为：

    首次启动要输入激活码；以后每次启动都停在“设备激活”页，激活码已经填好，
    点一下“登录”进主界面。

两条补丁：

1) 启动时只清会话令牌、不动激活码 —— 保证每次启动都停在激活页，而不是
   “这台机器已经登录过”就直接进主界面。
2) 激活页初始化时，先同步问一次本机代理
   （GET http://127.0.0.1:8081/vm/license，代理手里有安装目录里的授权票据），
   拿到就填进输入框并写回本地存储；代理没给出码时，才退回读本地存储。

第 2 条有两个作用：

* 兜底：Chromium 的 localStorage 是攒一批才落盘的（实测约 50 秒），激活完马上
  关软件、或者被任务管理器结束进程，这次写入就丢了，下次打开会看到空输入框。
  代理是在激活成功那一刻就把票据写进安装目录的，所以从代理兜一次底就不会丢。
* 取最新的那一份：本地存储里可能还留着更早一次激活的旧码（新码还没落盘时就会
  这样），授权票据跟激活是同步写的，比本地存储新，所以以代理为准。

本地存储里的码在授权失效（吊销 / 过期 / 换电脑）时不清空，仍然填在输入框里，
只有点“登录”请求服务器时才提示具体原因。
"""

RULES = [
    # 1) 启动时丢掉会话令牌（激活码留着，继续自动填）
    (
        "function ro(e){no(e)}",
        "function ro(e){no(e)}try{localStorage.removeItem(er)}catch{}",
    ),
    # 2) 激活页：优先用本机代理手里的激活码（最新），代理没给才退回本地存储
    (
        "A=u(localStorage.getItem(C)||``)",
        "A=u((function(){try{"
        "var e=new XMLHttpRequest();e.open(`GET`,"
        "`http://127.0.0.1:8081/vm/license`,!1);e.send();"
        "var t=JSON.parse(e.responseText||`{}`)||{},"
        "n=t.data&&t.data.activateCode||``;"
        "if(n){localStorage.setItem(C,n);return n}}catch{}"
        "return localStorage.getItem(C)||``})())",
    ),
]

# 每条补丁里“旧串”在 asar 里应当命中的次数，构建时人工核对。
EXPECTED_HITS = {
    RULES[0][0]: 1,
    RULES[1][0]: 1,
}
