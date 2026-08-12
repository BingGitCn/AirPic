# AirPic

> 手机照片，经局域网直连，落入你选定的文件夹。
> Phone photos, over a direct local link, into the folder you choose.

打开网页就能用 —— 电脑端不装软件，手机端不装 App，照片通过 **WebRTC** 在设备间**点对点**直传，**不经过任何服务器**。

---

## 怎么用 · How it works

1. **电脑**打开网页，点「选择文件夹」。
2. 用**手机**扫屏幕上的二维码。
3. 手机上**拍照或选图** —— 照片自动存进电脑刚才选的文件夹。

1. **Computer**: open this page, click **Choose a folder**.
2. **Phone**: scan the QR code on screen.
3. **Shoot or pick** on the phone — photos land in the folder you chose.

## 它怎么做到的 · How it really works

```
电脑 (Receiver)            PeerJS broker (wss)            手机 (Sender)
 选文件夹 + 注册监听 ─────▶ 信令中转 ─────▶ 扫码连接
        ◀── 信令交换 (SDP / ICE) ──▶
            DataChannel 建立 (P2P)          ← broker 脱钩
        ◀── 照片分块直传 (16KB, 不经服务器) ────
```

- **信令**：连接建立前，设备借助免费的 **PeerJS 公共 broker** 交换握手信息（SDP/ICE）。**无需账号、无需 API key、无需任何配置**。
- **传输**：握手完成后，照片字节走浏览器间的 **纯 P2P 数据通道**。broker 立即脱钩，照片**不经过任何服务器**。
- **落盘**：电脑端用 **File System Access API** 把照片直接写进你选的文件夹。

## 要求 · Requirements

| | 需要 |
|---|---|
| **电脑端** | Chrome 或 Edge 桌面版（用到 File System Access API 自动写入文件夹）。Safari / Firefox 不支持自动写入。 |
| **手机端** | 任意现代移动浏览器（Safari、Chrome 等）。 |
| **网络** | 两台设备需在**同一局域网 / 同一 Wi-Fi** 下。 |

## 部署到 GitHub Pages · Deploy

纯静态，无构建步骤：

1. 把整个目录推到你 GitHub 的仓库（例如 `AirPic`）。
2. 仓库 **Settings → Pages → Source**：选 `main` 分支、`/ (root)` 目录，保存。
3. 等约一分钟，访问 `https://<你的用户名>.github.io/AirPic/`。

本地预览：在项目根目录跑任意静态服务器，例如

```bash
python -m http.server 8080
# 然后浏览器打开 http://localhost:8080/
```

> 注意：File System Access API 与 WebRTC 需要安全上下文（HTTPS）。`localhost` 视同安全；局域网 IP 访问则需自行配 HTTPS。

## 隐私 · Privacy

你的照片**不经过任何服务器**。连接是点对点、端到端加密的。唯一的第三方依赖是 PeerJS 的公共信令服务，它只在连接建立前的毫秒级握手时被调用，只转发 SDP/ICE 信令文本，**永远看不到照片内容**，握手完成后即脱钩。

Your photos never touch a server. The connection is direct and end-to-end encrypted. The only third-party dependency is the free public PeerJS signaling broker, used only for the sub-second handshake before the connection opens; it carries SDP/ICE text only, never your image bytes, and steps aside once the peer-to-peer link is up.

## 目录结构 · Structure

```
AirPic/
├── index.html                 # 单入口，PC/手机视图都在此
├── styles.css                 # 全部样式
├── vendor/
│   ├── peerjs.min.js          # PeerJS (UMD, 暴露 window.Peer)
│   └── qr-creator.min.mjs     # 二维码渲染 (ESM)
├── app/
│   ├── main.js                # 引导：语言 + 角色路由
│   ├── i18n.js                # 中英字典 + 应用函数
│   ├── lib.js                 # 工具：PeerJS / FS Access / 二维码 / DOM
│   ├── receiver.js            # 电脑端逻辑
│   └── sender.js              # 手机端逻辑
├── README.md
└── .nojekyll
```

## 已知限制 · Known limits

- **同一 Wi-Fi**：WebRTC 在局域网靠 host 候选直连。若设备分处不同子网、访客 Wi-Fi、开启了 AP 隔离，或开了 VPN，连接可能失败。极端情况下可在电脑 Chrome 访问 `chrome://flags/#enable-webrtc-hide-local-ips-with-mdns` 关闭 mDNS 隐藏作为逃生口。
- **公共信令偶发不稳**：PeerJS 公共 broker 是免费、尽力而为的服务，偶有限流或抖动；代码已做断线重连。如需更高稳定性，可自建 PeerJS broker 并修改 `app/lib.js` 里的 `newPeer`。
- **浏览器支持**：自动写入文件夹仅 Chromium 内核桌面浏览器支持；其余浏览器会在面板内给出平静提示。

## 许可 · License

MIT.
