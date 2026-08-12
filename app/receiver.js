// app/receiver.js — PC side: pick folder, listen on PeerJS, render QR,
// receive files into the folder, and (bidirectional) send files to the phone.
import * as lib from './lib.js?v=24';
import { t, getLang } from './i18n.js?v=24';

let dirHandle = null;
let peer = null;
let receivedCount = 0;
let activeConn = null;
let currentUrl = '';

let current = null;          // the file currently being written
let processChain = Promise.resolve();  // serializes meta → chunks → end per connection
let pendingDirName = null;   // name shown on the reconnect button (perm pending)

export async function initReceiver() {
  const pickBtn = lib.$('#pick-btn');
  const changeBtn = lib.$('#change-btn');
  const reconnectBtn = lib.$('#reconnect-btn');
  const newCodeBtn = lib.$('#new-code-btn');
  const copyLinkBtn = lib.$('#copy-link-btn');
  const folderName = lib.$('#folder-name');
  const unsupported = lib.$('#unsupported');
  const sendState = lib.$('#send-state');
  const fileFolder = lib.$('#file-folder');

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
    fileFolder.textContent = t('file.folder', getLang(), { name: handle.name });
    lib.hide(pickBtn);
    lib.show(changeBtn);
  }
  function refreshFolderUI() {
    if (dirHandle) {
      folderName.textContent = t('folder.chosen', getLang(), { name: dirHandle.name });
      fileFolder.textContent = t('file.folder', getLang(), { name: dirHandle.name });
      lib.hide(pickBtn);
      lib.show(changeBtn);
      lib.hide(reconnectBtn);
    } else {
      folderName.textContent = t('folder.empty', getLang());
      fileFolder.textContent = t('file.folder.empty', getLang());
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

  // --- restore previously granted folder ---
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
  changeBtn.addEventListener('click', chooseFolder);
  reconnectBtn.addEventListener('click', async () => {
    const stored = await lib.getStoredDir();
    if (!stored) return;
    const ok = await lib.verifyPermission(stored, true).catch(() => false);
    if (ok) setFolder(stored);
  });
  newCodeBtn.addEventListener('click', () => {
    try { peer && peer.destroy && peer.destroy(); } catch {}
    current = null;
    startListening();
  });

  // copy pairing link
  copyLinkBtn.addEventListener('click', async () => {
    if (!currentUrl) return;
    try {
      await navigator.clipboard.writeText(currentUrl);
      const orig = copyLinkBtn.textContent;
      copyLinkBtn.textContent = t('link.copied', getLang());
      setTimeout(() => { copyLinkBtn.textContent = orig; }, 1600);
    } catch (e) { /* clipboard blocked */ }
  });

  // --- PC → phone sending: drop / pick / paste ---
  const drop = lib.$('#drop');
  const fileInput = lib.$('#pc-file-input');

  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('over');
    sendToPhone([...(e.dataTransfer ? e.dataTransfer.files : [])]);
  });
  fileInput.addEventListener('change', () => {
    sendToPhone([...(fileInput.files || [])]);
    fileInput.value = '';
  });
  document.addEventListener('paste', (e) => {
    const files = [...(e.clipboardData ? e.clipboardData.files : [])];
    if (files.length) sendToPhone(files);
  });

  function sendToPhone(files) {
    if (!activeConn || !activeConn.open) return;   // send-state already shows the idle hint
    for (const f of files) {
      const node = addActivity('out', f.name || 'file');
      lib.sendFile(activeConn, f, (got, total, start) => updateActivity(node, got, total, start))
        .then(() => markActivityDone(node));
    }
  }

  function setSendState(connected) {
    sendState.textContent = t(connected ? 'send.active' : 'send.idle', getLang());
  }

  refreshFolderUI(); // initial folder / file-folder state
  startListening();

  // --- refresh dynamic text on language change ---
  document.addEventListener('langchange', () => {
    setStatus(currentPeerState);
    refreshFolderUI();
    updateReceivedCount();
    setSendState(!!(activeConn && activeConn.open));
  });
}

// ---------------- activity list (both directions) ----------------
function addActivity(dir, name) {
  const node = lib.el(`
    <div class="act" data-dir="${dir}">
      <span class="act-tag">${t(dir === 'in' ? 'act.in' : 'act.out', getLang())}</span>
      <span class="act-name"></span>
      <span class="act-meta"></span>
      <span class="act-bar"><span class="act-fill"></span></span>
    </div>`);
  node.querySelector('.act-name').textContent = name;
  lib.$('#activity').prepend(node);
  return node;
}

function updateActivity(node, got, total, startMs) {
  const bar = node.querySelector('.act-fill');
  if (bar) bar.style.width = (total > 0 ? Math.min(100, (got / total) * 100) : 0).toFixed(1) + '%';
  const now = performance.now();
  if (now - (node._lastMeta || 0) > 120) {
    node._lastMeta = now;
    const meta = node.querySelector('.act-meta');
    if (!meta) return;
    const ms = now - startMs;
    meta.textContent = lib.fmtRate(got, ms) + (got < total ? ' · ' + lib.fmtEta(total - got, got, ms) : '');
  }
}

function markActivityDone(node) {
  if (!node) return;
  node.classList.add('done');
  const fill = node.querySelector('.act-fill');
  if (fill) fill.style.width = '100%';
  const meta = node.querySelector('.act-meta');
  if (meta) meta.textContent = '✓';
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
  currentUrl = lib.roomUrl(roomId);
  lib.renderQr(lib.$('#qr-canvas'), currentUrl);
  setStatus('waiting');

  peer = lib.newPeer(roomId);

  peer.on('open', () => { /* registered with broker */ });

  peer.on('connection', (conn) => setupConnection(conn));

  peer.on('disconnected', () => {
    try { peer.reconnect(); } catch {}
  });

  peer.on('error', (err) => {
    console.warn('[AirPic peer error]', err && err.type, err && err.message);
    const type = err && err.type;
    if (type === 'unavailable-id' || type === 'network' || type === 'server-error' || type === 'socket-error') {
      try { peer.destroy(); } catch {}
      setTimeout(() => startListening(attempt + 1), 900);
    } else if (type === 'peer-unavailable') {
      // stale id from a phone — ignore
    } else {
      setStatus('error');
    }
  });
}

function setupConnection(conn) {
  activeConn = conn;
  processChain = Promise.resolve();
  if (conn.dataChannel) {
    try { conn.dataChannel.binaryType = 'arraybuffer'; } catch {}
  }

  const openTimer = setTimeout(() => {
    if (!conn.open) setStatus('network'); // scanned, but the data channel never opened (likely different network)
  }, 6000);
  conn.on('open', () => {
    clearTimeout(openTimer);
    setStatus('connected');
    setSendState(true);
  });
  conn.on('data', (data) => handle(conn, data));
  conn.on('close', () => {
    setStatus('waiting');
    current = null;
    activeConn = null;
    setSendState(false);
  });
  conn.on('error', (e) => { console.warn('[AirPic conn error]', e); setStatus('error'); });
}

// Ordered processing: async 'meta' finishes before the first chunk is written.
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
      if (data.t === 'ack' || data.t === 'nack') lib.routeAck(data.id);
    }
  }).catch((e) => console.warn('[AirPic process error]', e));
}

async function startFile(conn, msg) {
  if (!dirHandle) {
    current = null;
    lib.safeSend(conn, { t: 'nack', id: msg.id, reason: 'no-folder' });
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
      start: performance.now(),
      node: addActivity('in', handle.name),
    };
    setStatus('receiving');
  } catch (e) {
    console.warn('[AirPic write open failed]', e);
    lib.safeSend(conn, { t: 'nack', id: msg.id, reason: 'write-failed' });
    current = null;
  }
}

function writeChunk(buf) {
  const c = current;
  if (!c) return;
  c.got += buf.byteLength;
  updateActivity(c.node, c.got, c.size, c.start);
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
    markActivityDone(c.node);
    lib.safeSend(conn, { t: 'ack', id, ok: true });
    setStatus('connected');
  } catch (e) {
    console.warn('[AirPic close failed]', e);
    lib.safeSend(conn, { t: 'ack', id, ok: false });
    setStatus('error');
  }
}
