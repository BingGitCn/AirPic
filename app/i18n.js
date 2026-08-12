// app/i18n.js — bilingual strings + apply/switch
// Copy: short, confident, a touch literary.

export const dict = {
  zh: {
    'tagline': '局域网照片直传',
    'hero.title.a': '快门一按，',
    'hero.title.b': '即达。',
    'hero.sub': '选个文件夹，手机扫一扫，照片便静静落下。',
    'flow': '选文件夹 · 扫二维码 · 拍下或选好 · 落下',

    'folder.select': '选择文件夹',
    'folder.chosen': '已选：{name}',
    'folder.reconnect': '重新连接文件夹',
    'folder.empty': '尚未选择文件夹',
    'folder.change': '更换文件夹',
    'pairing.new': '生成新配对码',
    'status.waiting': '等待连接',
    'status.connected': '已连接',
    'status.receiving': '接收中…',
    'status.done': '已完成',
    'status.error': '连接异常，正在重试',
    'received.count': '已收到 {n} 张',
    'qr.hint': '用手机扫码',
    'unsupported': '为获得自动保存体验，请在 Chrome 或 Edge 中打开。',
    'privacy': '不经服务器，端到端加密，设备直连。',
    'footer.note': '同一局域网 · 端到端加密 · 无需安装',

    'sender.title': '发送到这台电脑',
    'sender.status.connecting': '正在连接电脑…',
    'sender.status.connected': '已连接电脑',
    'sender.status.sending': '发送中…',
    'sender.status.disconnected': '已断开',
    'sender.status.error': '连接异常',
    'sender.status.pcOffline': '电脑不在线，请重扫二维码',
    'sender.camera': '拍照',
    'sender.gallery': '从相册选择',
    'sender.hint': '拍下或选好，照片即至电脑。',
    'sent.count': '已发送 {n} 张',
    'sender.sent.badge': '已送达',
    'sender.queued.badge': '排队中',
    'error.noFolder': '电脑端尚未选择文件夹'
  },
  en: {
    'tagline': 'Direct photo transfer · local network',
    'hero.title.a': 'One shutter press — ',
    'hero.title.b': 'it’s there.',
    'hero.sub': 'Pick a folder, scan with your phone, and the photos land quietly.',
    'flow': 'Choose folder · Scan code · Shoot or pick · Lands',

    'folder.select': 'Choose a folder',
    'folder.chosen': 'Folder: {name}',
    'folder.reconnect': 'Reconnect folder',
    'folder.empty': 'No folder chosen yet',
    'folder.change': 'Change folder',
    'pairing.new': 'New pairing code',
    'status.waiting': 'Waiting for connection',
    'status.connected': 'Connected',
    'status.receiving': 'Receiving…',
    'status.done': 'Done',
    'status.error': 'Connection trouble — retrying',
    'received.count': '{n} received',
    'qr.hint': 'Scan with your phone',
    'unsupported': 'For automatic saving, open in Chrome or Edge.',
    'privacy': 'No servers. End-to-end encrypted. Direct between devices.',
    'footer.note': 'Same local network · End-to-end encrypted · Nothing to install',

    'sender.title': 'Send to this computer',
    'sender.status.connecting': 'Connecting to the computer…',
    'sender.status.connected': 'Connected to the computer',
    'sender.status.sending': 'Sending…',
    'sender.status.disconnected': 'Disconnected',
    'sender.status.error': 'Connection trouble',
    'sender.status.pcOffline': 'Computer offline — please rescan',
    'sender.camera': 'Take photo',
    'sender.gallery': 'Pick from gallery',
    'sender.hint': 'Shoot or pick — photos arrive in an instant.',
    'sent.count': '{n} sent',
    'sender.sent.badge': 'delivered',
    'sender.queued.badge': 'queued',
    'error.noFolder': 'No folder chosen on the computer yet'
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
