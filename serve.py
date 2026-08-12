#!/usr/bin/env python3
"""
AirPic 本地静态服务器。

为什么不用 `python -m http.server`?
在 Windows 上,Python 的 http.server 经常把 .js / .mjs 当作 text/plain 发送,
而浏览器对 <script type="module"> 强制要求 JavaScript MIME 类型,
于是模块被拒载、整个页面脚本不执行。本脚本强制 .js/.mjs 返回 text/javascript。

用法:  python serve.py [port]      (默认 8080)
然后浏览器打开:  http://localhost:8080/
"""
import os
import sys
import http.server
import socketserver


class Handler(http.server.SimpleHTTPRequestHandler):
    # 强制 JS 模块的 MIME 类型,避免被当成 text/plain 导致模块加载失败
    def guess_type(self, path):
        if path.endswith(".js") or path.endswith(".mjs"):
            return "text/javascript; charset=utf-8"
        if path.endswith(".wasm"):
            return "application/wasm"
        return super().guess_type(path)


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("127.0.0.1", port), Handler) as httpd:
        print(f"AirPic serving on http://127.0.0.1:{port}/  (Ctrl+C to stop)")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nstopped.")


if __name__ == "__main__":
    main()
