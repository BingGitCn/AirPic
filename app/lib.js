// app/lib.js — shared utilities: DOM, room id, QR, PeerJS config, FS Access, bytes.
// qrcode-generator is loaded as a classic script (exposes window.qrcode).

// ---------------- DOM ----------------
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}
export const show = (node) => { if (node) node.hidden = false; };
export const hide = (node) => { if (node) node.hidden = true; };

// ---------------- room id / routing ----------------
const ROOM_PREFIX = 'airpic-';

export function genRoomId() {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  const s = [...bytes].map((b) => b.toString(36).padStart(2, '0')).join('');
  return ROOM_PREFIX + s;
}

export function roomUrl(roomId) {
  return location.origin + location.pathname + '#r=' + encodeURIComponent(roomId);
}

export function roomIdFromHash() {
  const m = location.hash.match(/[#&]r=([^&]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

// ---------------- QR ----------------
// Draws a standard, highly scannable QR: square modules + proper quiet zone.
// (qr-creator rounded modules + no margin made many phone scanners fail with "no text".)
export function renderQr(canvas, data) {
  if (!canvas || !window.qrcode) return;
  const qr = window.qrcode(0, 'M'); // type 0 = auto, ecLevel 'M'
  qr.addData(data || '');
  qr.make();
  const count = qr.getModuleCount();
  const margin = 4;              // quiet zone, in modules
  const total = count + margin * 2;
  const size = 256;
  const cell = size / total;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  canvas.width = size;
  canvas.height = size;
  ctx.fillStyle = '#faf6f1';     // background + quiet zone — warm cream
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = '#5c4033';     // dark modules — Deep Earth (warm brown)
  for (let r = 0; r < count; r++) {
    for (let c = 0; c < count; c++) {
      if (qr.isDark(r, c)) ctx.fillRect((c + margin) * cell, (r + margin) * cell, cell, cell);
    }
  }
}

// ---------------- PeerJS (uses global window.Peer from UMD build) ----------------
export const ICE_CONFIG = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
  sdpSemantics: 'unified-plan',
};

export function newPeer(id) {
  if (!window.Peer) throw new Error('PeerJS not loaded');
  return new window.Peer(id, { debug: 1, config: ICE_CONFIG });
}

// ---------------- IndexedDB (tiny kv, for FileSystemDirectoryHandle persistence) ----------------
const IDB_NAME = 'airpic';
const IDB_STORE = 'kv';

function idb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function idbGet(key) {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const r = db.transaction(IDB_STORE).objectStore(IDB_STORE).get(key);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export async function idbSet(key, value) {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const r = db.transaction(IDB_STORE, 'readwrite').objectStore(IDB_STORE).put(value, key);
    r.onsuccess = () => resolve();
    r.onerror = () => reject(r.error);
  });
}

// ---------------- File System Access ----------------
export const fsSupported = typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';

export async function pickDirectory() {
  const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
  await idbSet('dir', handle);
  return handle;
}

export async function getStoredDir() {
  try {
    return (await idbGet('dir')) || null;
  } catch {
    return null;
  }
}

export async function verifyPermission(handle, write = true) {
  const opts = { mode: write ? 'readwrite' : 'read' };
  const q = typeof handle.queryPermission === 'function'
    ? await handle.queryPermission(opts)
    : 'prompt';
  if (q === 'granted') return true;
  const r = typeof handle.requestPermission === 'function'
    ? await handle.requestPermission(opts)
    : 'prompt';
  return r === 'granted';
}

export function sanitizeName(name) {
  const base = String(name || '').replace(/[\/\\:*?"<>|]+/g, '_').replace(/\s+/g, ' ').trim();
  return base || 'photo';
}

// Resolve a non-clobbering file handle inside dirHandle for the given desired name.
export async function uniqueFileHandle(dirHandle, name) {
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  let candidate = name;
  let i = 1;
  for (;;) {
    try {
      // exists? throws NotFoundError if not
      await dirHandle.getFileHandle(candidate, { create: false });
      candidate = `${stem} (${i})${ext}`;
      i++;
    } catch (err) {
      if (err && err.name === 'TypeMismatchError') {
        // a directory with this name exists; disambiguate
        candidate = `${stem} (${i})${ext}`;
        i++;
        continue;
      }
      // NotFoundError → free name
      return dirHandle.getFileHandle(candidate, { create: true });
    }
  }
}

// ---------------- bytes ----------------
export function fmtBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1073741824) return `${(n / 1048576).toFixed(1)} MB`;
  return `${(n / 1073741824).toFixed(2)} GB`;
}

// ---------------- file transfer (shared by both directions) ----------------
const CHUNK_SIZE = 16 * 1024;          // 16 KiB
const LOW_THRESHOLD = 1 << 20;         // 1 MiB bufferedAmountLowThreshold
let sendSeq = 0;
const pendingAcks = new Map();         // id -> { resolve, timer }

export function safeSend(conn, obj) {
  try { if (conn && conn.open) conn.send(obj); } catch (e) { console.warn('[AirPic send]', e); }
}

// Called by a receiver when it gets an ack/nack for a file this side sent.
export function routeAck(id) {
  const slot = pendingAcks.get(id);
  if (slot) { clearTimeout(slot.timer); pendingAcks.delete(id); slot.resolve(); }
}

// Send one file over the connection with backpressure; resolves on ack/timeout.
// onProgress(offset, total, startMs) fires as chunks are queued.
export function sendFile(conn, file, onProgress) {
  return new Promise(async (resolve) => {
    if (!conn || !conn.open) { resolve({ ok: false }); return; }
    const dc = conn.dataChannel;
    if (dc) dc.bufferedAmountLowThreshold = LOW_THRESHOLD;
    let buf;
    try { buf = await file.arrayBuffer(); } catch (e) { resolve({ ok: false }); return; }
    const id = ++sendSeq;
    const name = file.name || `file-${id}`;
    safeSend(conn, { t: 'meta', id, name, size: file.size, mime: file.type || '' });
    const total = buf.byteLength;
    let offset = 0;
    const start = performance.now();
    await new Promise((pResolve) => {
      const pump = () => {
        while (offset < total) {
          if (dc && dc.bufferedAmount > LOW_THRESHOLD) {
            dc.addEventListener('bufferedamountlow', pump, { once: true });
            return;
          }
          const end = Math.min(offset + CHUNK_SIZE, total);
          try { conn.send(buf.slice(offset, end)); } catch (e) { pResolve(); return; }
          offset = end;
          if (onProgress) onProgress(offset, total, start);
        }
        safeSend(conn, { t: 'end', id });
        const slot = {};
        pendingAcks.set(id, slot);
        slot.resolve = () => { pendingAcks.delete(id); pResolve(); };
        slot.timer = setTimeout(() => { if (pendingAcks.has(id)) { pendingAcks.delete(id); pResolve(); } }, 60000);
      };
      pump();
    });
    resolve({ ok: true, id, name, size: total });
  });
}

// ---------------- rate / ETA formatting ----------------
export function fmtRate(bytes, ms) {
  if (ms <= 0) return '';
  const r = bytes / (ms / 1000);
  if (r < 1024) return r.toFixed(0) + ' B/s';
  if (r < 1048576) return (r / 1024).toFixed(1) + ' KB/s';
  return (r / 1048576).toFixed(1) + ' MB/s';
}
export function fmtEta(bytesLeft, bytesDone, ms) {
  if (bytesDone <= 0 || ms <= 0) return '';
  const rate = bytesDone / (ms / 1000);
  if (rate <= 0) return '';
  const s = bytesLeft / rate;
  if (!isFinite(s) || s <= 0) return '';
  if (s < 60) return Math.ceil(s) + 's';
  return Math.ceil(s / 60) + 'm';
}

// Trigger a browser download for a received blob (used on the phone side).
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
