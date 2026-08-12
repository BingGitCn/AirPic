// app/receiver.js — PC side: pick folder, listen on PeerJS, render QR, write incoming files.
import * as lib from './lib.js?v=13';
import { t, getLang } from './i18n.js?v=13';

let dirHandle = null;
let peer = null;
let receivedCount = 0;

let current = null;          // the file currently being written
let processChain = Promise.resolve();  // serializes meta → chunks → end per connection

let pendingDirName = null;   // name shown on the reconnect button (perm pending)

export async function initReceiver() {
  const pickBtn = lib.$('#pick-btn');
  const changeBtn = lib.$('#change-btn');
  const reconnectBtn = lib.$('#reconnect-btn');
  const newCodeBtn = lib.$('#new-code-btn');
  const folderName = lib.$('#folder-name');
  const unsupported = lib.$('#unsupported');

  // --- browser support ---
  if (!lib.fsSupported) {
    lib.show(unsupported);
    lib.hide(pickBtn);
    lib.hide(reconnectBtn);
    lib.hide(changeBtn);
    lib.hide(newCodeBtn);
  }

  // --- folder UI state helpers ---
  function setFolder(handle) {
    dirHandle = handle;
    pendingDirName = null;
    lib.hide(reconnectBtn);
    folderName.textContent = t('folder.chosen', getLang(), { name: handle.name });
    lib.hide(pickBtn);
    lib.show(changeBtn);
  }
  function refreshFolderUI() {
    if (dirHandle) {
      folderName.textContent = t('folder.chosen', getLang(), { name: dirHandle.name });
      lib.hide(pickBtn);
      lib.show(changeBtn);
      lib.hide(reconnectBtn);
    } else {
      folderName.textContent = t('folder.empty', getLang());
      lib.show(pickBtn);
      lib.hide(changeBtn);
      if (pendingDirName) {
        lib.show(reconnectBtn);
        reconnectBtn.textContent = `${t('folder.reconnect', getLang())} · ${pendingDirName}`;
      }
    }
  }
  async function chooseFolder() {
    try { setFolder(await lib.pickDirectory()); } catch (e) { /* cancelled */ }
  }

  // --- restore previously granted folder (permission is origin-bound) ---
  if (lib.fsSupported) {
    const stored = await lib.getStoredDir();
    if (stored) {
      let perm = 'prompt';
      try { perm = await stored.queryPermission({ mode: 'readwrite' }); } catch {}
      if (perm === 'granted') {
        setFolder(stored);
      } else {
        pendingDirName = stored.name;
        lib.show(reconnectBtn);
        reconnectBtn.textContent = `${t('folder.reconnect', getLang())} · ${stored.name}`;
      }
    }
  }

  // --- actions ---
  pickBtn.addEventListener('click', chooseFolder);
  changeBtn.addEventListener('click', chooseFolder);   // forget current + re-pick
  reconnectBtn.addEventListener('click', async () => {
    const stored = await lib.getStoredDir();
    if (!stored) return;
    const ok = await lib.verifyPermission(stored, true).catch(() => false);
    if (ok) setFolder(stored);
  });
  newCodeBtn.addEventListener('click', () => {
    // rotate to a fresh room id + QR (the old pairing code stops working)
    try { peer && peer.destroy && peer.destroy(); } catch {}
    current = null;
    startListening();
  });

  startListening();

  // --- refresh dynamic text on language change ---
  document.addEventListener('langchange', () => {
    setStatus(currentPeerState);
    refreshFolderUI();
    updateReceivedCount();
  });
}

let currentPeerState = 'waiting';
function setStatus(state) {
  currentPeerState = state;
  const el = lib.$('#qr-status');
  if (!el) return;
  el.dataset.state = state;
  el.textContent = t('status.' + state, getLang());
}

function updateReceivedCount() {
  const el = lib.$('#received-count');
  if (!el) return;
  el.textContent = receivedCount ? t('received.count', getLang(), { n: receivedCount }) : '';
}

function startListening(attempt = 0) {
  const roomId = lib.genRoomId();
  lib.renderQr(lib.$('#qr-canvas'), lib.roomUrl(roomId));
  setStatus('waiting');

  peer = lib.newPeer(roomId);

  peer.on('open', () => { /* registered with broker; QR already showing */ });

  peer.on('connection', (conn) => setupConnection(conn));

  peer.on('disconnected', () => {
    // broker link dropped — try to reattach silently
    try { peer.reconnect(); } catch {}
  });

  peer.on('error', (err) => {
    console.warn('[AirPic peer error]', err && err.type, err && err.message);
    const type = err && err.type;
    if (type === 'unavailable-id' || type === 'network' || type === 'server-error' || type === 'socket-error') {
      // registration failed or broker hiccup → fresh id, fresh QR
      try { peer.destroy(); } catch {}
      setTimeout(() => startListening(attempt + 1), 900);
    } else if (type === 'peer-unavailable') {
      // a phone tried a stale id; ignore — current QR is valid
    } else {
      setStatus('error');
    }
  });
}

function setupConnection(conn) {
  processChain = Promise.resolve();
  if (conn.dataChannel) {
    try { conn.dataChannel.binaryType = 'arraybuffer'; } catch {}
  }

  conn.on('open', () => setStatus('connected'));
  conn.on('data', (data) => handle(conn, data));
  conn.on('close', () => { setStatus('waiting'); current = null; });
  conn.on('error', (e) => { console.warn('[AirPic conn error]', e); setStatus('error'); });
}

// Ordered processing so that an async 'meta' finishes before the first chunk is written.
function handle(conn, data) {
  processChain = processChain.then(async () => {
    if (data instanceof ArrayBuffer) {
      writeChunk(data);
      return;
    }
    if (ArrayBuffer.isView(data)) {
      writeChunk(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
      return;
    }
    if (data && typeof data === 'object') {
      if (data.t === 'meta') return await startFile(conn, data);
      if (data.t === 'end') return await endFile(conn, data.id);
    }
  }).catch((e) => console.warn('[AirPic process error]', e));
}

async function startFile(conn, msg) {
  if (!dirHandle) {
    current = null;
    safeSend(conn, { t: 'nack', id: msg.id, reason: 'no-folder' });
    return;
  }
  try {
    const handle = await lib.uniqueFileHandle(dirHandle, lib.sanitizeName(msg.name));
    const writable = await handle.createWritable();
    current = {
      id: msg.id,
      name: handle.name,
      size: msg.size || 0,
      got: 0,
      writable,
      chain: Promise.resolve(),
    };
    setStatus('receiving');
  } catch (e) {
    console.warn('[AirPic write open failed]', e);
    safeSend(conn, { t: 'nack', id: msg.id, reason: 'write-failed' });
    current = null;
  }
}

function writeChunk(buf) {
  const c = current;
  if (!c) return; // chunk for a file we couldn't open — drop
  c.got += buf.byteLength;
  c.chain = c.chain.then(() => c.writable.write(buf)).catch((e) => {
    console.warn('[AirPic write chunk failed]', e);
  });
}

async function endFile(conn, id) {
  const c = current;
  if (!c || c.id !== id) return;
  current = null;
  try {
    await c.chain;
    await c.writable.close();
    receivedCount += 1;
    updateReceivedCount();
    safeSend(conn, { t: 'ack', id, ok: true });
    setStatus('connected');
  } catch (e) {
    console.warn('[AirPic close failed]', e);
    safeSend(conn, { t: 'ack', id, ok: false });
    setStatus('error');
  }
}

function safeSend(conn, obj) {
  try {
    if (conn && conn.open) conn.send(obj);
  } catch (e) {
    console.warn('[AirPic send failed]', e);
  }
}
