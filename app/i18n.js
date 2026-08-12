// app/i18n.js — bilingual strings + apply/switch
// Voice: warm, calm, a touch literary. Micro-copy stays short but human.

export const dict = {
  zh: {
    'tagline': '局域网照片直传',
    'mode.hint': '传照片 · 传文件',
    'step.connect': '用手机扫一扫',
    'mode.photo': '传照片',
    'mode.photo.desc': '选个文件夹，照片便静静落下',
    'mode.file': '传文件',
    'mode.file.desc': '与手机双向互传',

    'folder.select': '选一个文件夹',
    'folder.chosen': '已选：{name}',
    'folder.change': '换个文件夹',
    'folder.empty': '还没选文件夹',
    'folder.reconnect': '重新连接文件夹',
    'pairing.new': '生成新配对码',
    'link.copy': '复制配对链接',
    'link.copied': '已复制',
    'file.folder': '文件落入：{name}',
    'file.folder.empty': '选个文件夹，才能收到文件',
    'status.waiting': '等待手机连接',
    'status.connected': '已连接',
    'status.receiving': '正在接收…',
    'status.done': '已完成',
    'status.error': '连接异常，自动重试中',
    'status.network': '扫码了，但没连上——可能不在同一 Wi-Fi',
    'received.count': '已收 {n} 张',
    'qr.hint': '用手机扫一扫',
    'unsupported': '为获得自动保存体验，请在 Chrome 或 Edge 中打开。',
    'privacy': '照片不经服务器。设备直连，端到端加密。',
    'footer.note': '同一局域网 · 端到端加密 · 无需安装',
    'send.drop': '拖进来 · 点一下 · 或粘贴',
    'send.idle': '手机连上后即可发送',
    'send.active': '已连接 · 拖进来即发',

    'sender.title': '发往这台电脑',
    'sender.status.connecting': '正在连接电脑…',
    'sender.status.connected': '已连接电脑',
    'sender.status.sending': '发送中…',
    'sender.status.disconnected': '已断开',
    'sender.status.error': '连接异常',
    'sender.status.pcOffline': '电脑不在线，请重扫一下',
    'sender.status.duplicate': '此码已在另一个标签页打开',
    'sender.status.network': '两台设备不在同一 Wi-Fi，请连到同一个网络',
    'sender.camera': '拍照',
    'sender.gallery': '选择文件',
    'sender.hint': '拍下或选好，即至电脑。',
    'sent.count': '已发 {n} 张',
    'sender.sent.badge': '已送达',
    'sender.queued.badge': '排队中',
    'error.noFolder': '电脑端还没选文件夹',

    'act.in': '收',
    'act.out': '发',
    'act.sending': '发送中',
    'act.receiving': '接收中',
    'act.done': '完成',
    'recv.title': '电脑发来的',
    'recv.save': '保存',
    'recv.saved': '已保存'
  },
  en: {
    'tagline': 'Direct photo transfer · local network',
    'mode.hint': 'Photos · Files',
    'step.connect': 'Scan with your phone',
    'mode.photo': 'Photos',
    'mode.photo.desc': 'Pick a folder — photos land quietly',
    'mode.file': 'Files',
    'mode.file.desc': 'Both ways with your phone',

    'folder.select': 'Choose a folder',
    'folder.chosen': 'Folder: {name}',
    'folder.change': 'Choose another',
    'folder.empty': 'No folder yet',
    'folder.reconnect': 'Reconnect folder',
    'pairing.new': 'New pairing code',
    'link.copy': 'Copy pairing link',
    'link.copied': 'Copied',
    'file.folder': 'Files land in: {name}',
    'file.folder.empty': 'Pick a folder first to receive files',
    'status.waiting': 'Waiting for your phone',
    'status.connected': 'Connected',
    'status.receiving': 'Receiving…',
    'status.done': 'Done',
    'status.error': 'Connection trouble — retrying',
    'status.network': 'Scanned, but not connected — maybe not on the same Wi-Fi',
    'received.count': '{n} received',
    'qr.hint': 'Scan with your phone',
    'unsupported': 'For automatic saving, open in Chrome or Edge.',
    'privacy': 'No servers. Direct between devices. End-to-end encrypted.',
    'footer.note': 'Same local network · End-to-end encrypted · Nothing to install',
    'send.drop': 'Drag in · click · or paste',
    'send.idle': 'Works once your phone joins',
    'send.active': 'Connected — drag anything in',

    'sender.title': 'Send to this computer',
    'sender.status.connecting': 'Connecting to the computer…',
    'sender.status.connected': 'Connected',
    'sender.status.sending': 'Sending…',
    'sender.status.disconnected': 'Disconnected',
    'sender.status.error': 'Connection trouble',
    'sender.status.pcOffline': 'Computer offline — please rescan',
    'sender.status.duplicate': 'Already open in another tab',
    'sender.status.network': 'Devices aren’t on the same Wi-Fi — join the same network',
    'sender.camera': 'Take photo',
    'sender.gallery': 'Pick file',
    'sender.hint': 'Shoot or pick — it lands in an instant.',
    'sent.count': '{n} sent',
    'sender.sent.badge': 'delivered',
    'sender.queued.badge': 'queued',
    'error.noFolder': 'No folder chosen yet on the computer',

    'act.in': 'in',
    'act.out': 'out',
    'act.sending': 'Sending',
    'act.receiving': 'Receiving',
    'act.done': 'Done',
    'recv.title': 'From your computer',
    'recv.save': 'Save',
    'recv.saved': 'Saved'
  }
};

const STORE_KEY = 'airpic.lang';

export function getLang() {
  const saved = localStorage.getItem(STORE_KEY);
  if (saved === 'zh' || saved === 'en') return saved;
  return String(navigator.language || 'en').toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

export function setLang(lang) {
  localStorage.setItem(STORE_KEY, lang);
  apply(lang);
}

export function t(key, lang = getLang(), params) {
  const table = dict[lang] || dict.en;
  let s = table[key] != null ? table[key] : dict.en[key];
  if (s == null) s = key;
  if (params) for (const k in params) s = s.split('{' + k + '}').join(params[k]);
  return s;
}

export function apply(lang = getLang()) {
  document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
  document.querySelectorAll('[data-i18n]').forEach((node) => {
    node.textContent = t(node.dataset.i18n, lang);
  });
  document.querySelectorAll('[data-i18n-ph]').forEach((node) => {
    node.setAttribute('placeholder', t(node.dataset.i18nPh, lang));
  });
  document.dispatchEvent(new CustomEvent('langchange', { detail: { lang } }));
}
