# -*- coding: utf-8 -*-
"""界面改造时用的小工具：对着已经用 --remote-debugging-port 起好的客户端
截图 / 执行 JS / 取某个节点的 HTML。

用法：
    python ui-lab.py shot out.png                截图
    python ui-lab.py js "<表达式>"                执行 JS 并打印结果
    python ui-lab.py jsf path/to/x.js            执行 JS 文件
    python ui-lab.py html "<选择器>" [maxlen]     打印节点的 outerHTML
    python ui-lab.py classes "<选择器>"           打印节点自身的 class 列表
    python ui-lab.py click "<选择器>"             点一下
    python ui-lab.py text "<选择器>"              打印节点文字
    python ui-lab.py info                        打印地址、标题、窗口尺寸
    python ui-lab.py css path/to/skin.css        把 CSS 文件注进页面（开发时热改皮肤）
    python ui-lab.py theme light|dark|auto       切换白天/暗黑

端口用环境变量 VM_CDP_PORT 覆盖，默认 9222。
"""

import base64
import json
import os
import sys
import urllib.request

import websocket

PORT = int(os.environ.get("VM_CDP_PORT", "9222"))

for _name in ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY",
              "http_proxy", "https_proxy", "all_proxy"):
    os.environ.pop(_name, None)
os.environ["NO_PROXY"] = "127.0.0.1,localhost"
os.environ["no_proxy"] = "127.0.0.1,localhost"

OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))


class Page:
    def __init__(self, port=PORT):
        self.port = port
        self.seq = 0
        self.ws = None

    def connect(self):
        with OPENER.open("http://127.0.0.1:%d/json/list" % self.port, timeout=5) as fh:
            pages = [i for i in json.load(fh) if i.get("type") == "page"]
        if not pages:
            raise SystemExit("没有可调试的页面，客户端起来了吗？")
        self.ws = websocket.create_connection(pages[0]["webSocketDebuggerUrl"],
                                              timeout=120, suppress_origin=True)

    def call(self, method, params=None):
        self.seq += 1
        self.ws.send(json.dumps({"id": self.seq, "method": method,
                                 "params": params or {}}))
        while True:
            message = json.loads(self.ws.recv())
            if message.get("id") == self.seq:
                if "error" in message:
                    raise SystemExit("CDP 出错：%s" % json.dumps(
                        message["error"], ensure_ascii=False))
                return message.get("result", {})

    def js(self, expression):
        result = self.call("Runtime.evaluate", {
            "expression": expression, "returnByValue": True,
            "awaitPromise": True, "userGesture": True})
        details = result.get("exceptionDetails")
        if details:
            desc = (details.get("exception") or {}).get("description") or json.dumps(
                details, ensure_ascii=False)
            raise SystemExit("JS 异常：%s" % desc)
        return result.get("result", {}).get("value")

    def shot(self, path):
        result = self.call("Page.captureScreenshot", {"format": "png"})
        data = base64.b64decode(result["data"])
        with open(path, "wb") as fh:
            fh.write(data)
        return len(data)


HELPERS = (
    "window.__vmq=function(s,r){return (r||document).querySelector(s)};"
    "window.__vma=function(s,r){return Array.prototype.slice.call((r||document).querySelectorAll(s))};"
    "window.__vmtext=function(el){return el?(el.innerText||el.textContent||'').trim():''};"
    "true"
)


def main(argv):
    if len(argv) < 2:
        print(__doc__)
        return 2
    cmd = argv[1]
    page = Page()
    page.connect()
    page.js(HELPERS)

    if cmd == "shot":
        size = page.shot(argv[2])
        print("已保存 %s（%d 字节）" % (argv[2], size))
    elif cmd == "js":
        value = page.js(argv[2])
        print(json.dumps(value, ensure_ascii=False, indent=2)
              if isinstance(value, (dict, list)) else value)
    elif cmd == "jsf":
        text = open(argv[2], encoding="utf-8").read()
        value = page.js(text)
        print(json.dumps(value, ensure_ascii=False, indent=2)
              if isinstance(value, (dict, list)) else value)
    elif cmd == "html":
        limit = int(argv[3]) if len(argv) > 3 else 4000
        value = page.js(
            "(function(){var el=__vmq(%s);return el?el.outerHTML.slice(0,%d):'（没找到）'})()"
            % (json.dumps(argv[2]), limit))
        print(value)
    elif cmd == "classes":
        value = page.js(
            "(function(){var el=__vmq(%s);return el?Array.prototype.slice.call(el.classList):[]})()"
            % json.dumps(argv[2]))
        print(json.dumps(value, ensure_ascii=False))
    elif cmd == "text":
        value = page.js(
            "(function(){var el=__vmq(%s);return el?(el.innerText||'').trim():'（没找到）'})()"
            % json.dumps(argv[2]))
        print(value)
    elif cmd == "click":
        page.js("(function(){var el=__vmq(%s);if(el){el.click();return true}return false})()"
                % json.dumps(argv[2]))
        print("ok")
    elif cmd == "info":
        value = page.js(
            "({url:location.href,title:document.title,"
            "w:document.documentElement.clientWidth,h:document.documentElement.clientHeight,"
            "theme:document.documentElement.getAttribute('data-vm-theme'),"
            "bodyClass:document.body.className})")
        print(json.dumps(value, ensure_ascii=False, indent=2))
    elif cmd == "css":
        text = open(argv[2], encoding="utf-8").read()
        value = page.js(
            "(function(t){"
            "var id='vm-skin-dev';var el=document.getElementById(id);"
            "if(!el){el=document.createElement('style');el.id=id;document.head.appendChild(el)}"
            "el.textContent=t;document.head.appendChild(el);"
            "return el.textContent.length})(" + json.dumps(text) + ")")
        print("已注入 CSS，%d 字符" % value)
    elif cmd == "theme":
        want = argv[2]
        value = page.js(
            "(function(w){"
            "if(w==='auto'){document.documentElement.removeAttribute('data-vm-theme');"
            "localStorage.removeItem('vm-theme');return 'auto'}"
            "document.documentElement.setAttribute('data-vm-theme',w);"
            "localStorage.setItem('vm-theme',w);return w})(" + json.dumps(want) + ")")
        print("主题：" + str(value))
    else:
        print(__doc__)
        return 2
    return 0


if __name__ == "__main__":
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(errors="replace")
        except Exception:
            pass
    raise SystemExit(main(sys.argv))
