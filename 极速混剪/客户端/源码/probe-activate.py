# -*- coding: utf-8 -*-
"""Start a throwaway backend and exercise /rpc/authActivateCode directly."""

import json
import pathlib
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

PY = r"C:\Users\Administrator\AppData\Local\Programs\Python\Python312\python.exe"
WEBDIR = pathlib.Path(r"E:\GPT Codex\2026-09-15\new-chat\outputs\videomix-web")
SIGNKEY = pathlib.Path(r"E:\GPT Codex\2026-09-15\new-chat\work\videomix-rebuild\keys\license-private.xml")
DATA = pathlib.Path(r"E:\GPT Codex\2026-09-15\new-chat\work\rebrand\probe-data")
PORT = 8084
BASE = "http://127.0.0.1:%d" % PORT
DEVICE = "f1327276-44f0-0f34-5eeb-9000800070A1"


def call(method, path, body=None, cookie=None):
    data = json.dumps(body).encode("utf-8") if body is not None else None
    # 本机请求必须绕开系统代理，否则会挂在代理上
    url = BASE + (path if path.startswith("/api") else urllib.parse.quote(path, safe="/?=&"))
    request = urllib.request.Request(url, data=data, method=method)
    request.add_header("Content-Type", "application/json")
    if cookie:
        request.add_header("Cookie", cookie)
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open(request, timeout=15) as response:
        raw = response.read().decode("utf-8")
        headers = response.headers
    try:
        return json.loads(raw), headers
    except ValueError:
        return raw, headers


def main():
    DATA.mkdir(parents=True, exist_ok=True)
    proc = subprocess.Popen(
        [PY, "server.py", "--host", "127.0.0.1", "--port", str(PORT),
         "--data-dir", str(DATA), "--signing-key", str(SIGNKEY)],
        cwd=str(WEBDIR), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        for _ in range(60):
            time.sleep(0.25)
            try:
                if call("GET", "/health")[0].get("ok"):
                    break
            except Exception:
                pass
        else:
            raise SystemExit("backend did not start")

        _, headers = call("POST", "/api/login",
                          {"username": "admin", "password": "admin123"})
        cookie = headers.get("Set-Cookie", "").split(";")[0]
        batch, _ = call("POST", "/api/batches",
                        {"name": "probe", "quantity": 2, "days": 365, "maxDevices": 1}, cookie)
        codes, _ = call("GET", "/api/codes?batchId=%s" % batch["id"], None, cookie)
        code = codes["data"][0]["code"]
        print("code:", code)

        good, _ = call("POST", "/rpc/authActivateCode",
                       {"activateCode": code, "deviceId": DEVICE, "category": 2})
        print("good request ->", json.dumps(good, ensure_ascii=False)[:600])
        print("   has ticket:", "ticket" in (good if isinstance(good, dict) else {}))

        second = codes["data"][1]["code"]
        bad, _ = call("POST", "/rpc/authActivateCode",
                      {"activateCode": second + "X", "deviceId": DEVICE, "category": 2})
        print("bad request  ->", json.dumps(bad, ensure_ascii=False)[:300])
        return 0
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()


if __name__ == "__main__":
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(errors="replace")
        except Exception:
            pass
    raise SystemExit(main())
