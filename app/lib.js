// app/lib.js — shared utilities: DOM, room id, QR, PeerJS config, FS Access, bytes.
import QrCreator from '../vendor/qr-creator.min.mjs';

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
export function renderQr(canvas, data) {
  QrCreator.render(
    { data, size: 256, fill: '#1C1C1A', background: '#FAFAF7', ecLevel: 'M' },
    canvas
  );
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
