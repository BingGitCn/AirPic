// app/sender.js — phone side: connect to room, send photos/files to the computer,
// and receive files the computer sends back (save to downloads).
import * as lib from './lib.js?v=23';
import { t, getLang } from './i18n.js?v=23';

let peer = null;
let conn = null;
let sawPeerUnavailable = false;   // PC peer id not registered (offline / stale QR)
let queue = [];
let busy = false;
let seq = 0;
let sentCount = 0;

// receiving from the computer (PC → phone)
let recvCurrent = null;
let recvChain = Promise.resolve();

export function initSender(roomId) {
  // inputs (gallery accepts any file type now)
  lib.$('#camera-input').addEventListener('change', onPick);
  lib.$('#gallery-input').addEventListener('change', onPick);

  document.addEventListener('langchange', () => {
    setStatus(lastState);
    updateSentCount();
  });

  // QR scanners often open the same link in several tabs — elect one leader,
  // the others show a notice and take over only if the leader closes.
  setStatus('connecting');
  electLeader(roomId, () => connect(roomId));
}

function connect(roomId) {
  setStatus('connecting');

  peer = lib.newPeer(); // random id

  peer.on('open', () => connectWithRetry(roomId));

  peer.on('disconnected', () => { try { peer.reconnect(); } catch {} });

  peer.on('error', (err) => {
    console.warn('[AirPic peer error]', err && err.type, err && err.message);
    if (err && err.type === 'peer-unavailable') {
      sawPeerUnavailable = true; // PC not registered — let the retry timer decide
    } else {
      setStatus('error');
    }
  });
}

// --- duplicate-tab leader election (BroadcastChannel, same origin) ---
function electLeader(roomId, onLeader) {
  let bc;
  try { bc = new BroadcastChannel('airpic-room-' + roomId); } catch (e) { onLeader(); return; }

  const myId = Math.random().toString(36).slice(2, 8);
  const claims = new Map([[myId, Date.now()]]);
  let sawBeat = false;
  let settled = false;
  let lastBeat = Date.now();

  bc.onmessage = (e) => {
    const d = e.data;
    if (!d) return;
    if (d.t === 'claim') {
      claims.set(d.id, Date.now());
      if (settled) { try { bc.postMessage({ t: 'beat' }); } catch {} } // leader asserts itself
    } else if (d.t === 'beat') {
      sawBeat = true;
      lastBeat = Date.now();
    }
  };

  const becomeLeader = () => {
    if (settled) return;
    settled = true;
    setInterval(() => { try { bc.postMessage({ t: 'beat' }); } catch {} }, 1000);
    onLeader();
  };
  const becomeDuplicate = () => {
    if (settled) return;
    settled = true;
    setStatus('duplicate');
    const t = setInterval(() => {
      if (Date.now() - lastBeat > 3000) { // leader tab closed — take over
        clearInterval(t);
        try { bc.close(); } catch {}
        electLeader(roomId, onLeader);
      }
    }, 800);
  };

  try { bc.postMessage({ t: 'claim', id: myId }); } catch {}

  setTimeout(() => {
    if (settled) return;
    const ids = [...claims.keys()].sort();
    const lowest = ids[0] === myId;
    if (sawBeat || !lowest) becomeDuplicate();
    else becomeLeader();
  }, 350);
}

let lastState = 'connecting';
function setStatus(state) {
  lastState = state;
  const el = lib.$('#sender-status');
  if (!el) return;
  el.dataset.state = state;
  el.textContent = t('sender.status.' + state, getLang());
}
function updateSentCount() {
  const el = lib.$('#sent-count');
  if (!el) return;
  el.textContent = sentCount ? t('sent.count', getLang(), { n: sentCount }) : '';
}

// --- connect, retrying briefly in case the PC is still registering ---
function connectWithRetry(roomId, attempt = 0) {
  conn = peer.connect(roomId, { reliable: true }); // default serialization (objects + ArrayBuffer)

  conn.on('open', () => { setStatus('connected'); drain(); });
  conn.on('data', onData);
  conn.on('close', () => { setStatus('disconnected'); conn = null; });
  conn.on('error', (e) => console.warn('[AirPic conn error]', e));

  const openTimer = setTimeout(() => {
    if (!conn || !conn.open) {
      if (attempt < 6) {
        try { conn && conn.close && conn.close(); } catch {}
        setTimeout(() => connectWithRetry(roomId, attempt + 1), 900);
      } else {
        // signaling worked but the channel never opened: PC offline vs different network
        setStatus(sawPeerUnavailable ? 'pcOffline' : 'network');
      }
    }
  }, 2500);

  conn.on('open', () => clearTimeout(openTimer));
}

function onPick(e) {
  const input = e.target;
  const files = [...(input.files || [])];
  input.value = ''; // allow re-selecting the same file later
  for (const f of files) {
    seq += 1;
    addThumb(f, seq);
    queue.push({ id: seq, file: f });
  }
  drain();
}

async function drain() {
  if (busy) return;
  busy = true;
  while (queue.length) {
    if (!conn || !conn.open) break; // resume when the channel (re)opens
    const job = queue.shift();
    await sendOne(job.id, job.file);
  }
  busy = false;
  if (conn && conn.open && !queue.length) setStatus('connected');
}

function sendOne(id, file) {
  return new Promise(async (resolve) => {
    if (!conn || !conn.open) { queue.unshift({ id, file }); resolve(); return; }
    setStatus('sending');
    await lib.sendFile(conn, file, (got, total, start) => updateThumb(id, got, total, start));
    markThumb(id, 'done');
    sentCount += 1;
    updateSentCount();
    resolve();
  });
}

// --- incoming from the computer (PC → phone): download + save ---
function onData(data) {
  recvChain = recvChain.then(async () => {
    if (data instanceof ArrayBuffer) {
      if (recvCurrent) { recvCurrent.chunks.push(data); updateRecvProgress(); }
      return;
    }
    if (ArrayBuffer.isView(data)) {
      if (recvCurrent) {
        recvCurrent.chunks.push(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
        updateRecvProgress();
      }
      return;
    }
    if (data && typeof data === 'object') {
      if (data.t === 'meta') {
        recvCurrent = {
          id: data.id,
          name: data.name || 'file',
          size: data.size || 0,
          chunks: [],
          start: performance.now(),
          node: addRecvItem(data.name || 'file'),
        };
      } else if (data.t === 'end') {
        if (recvCurrent) {
          const c = recvCurrent;
          recvCurrent = null;
          c.blob = new Blob(c.chunks, { type: 'application/octet-stream' });
          markRecvReady(c);
          lib.safeSend(conn, { t: 'ack', id: c.id, ok: true });
        }
      } else if (data.t === 'ack' || data.t === 'nack') {
        lib.routeAck(data.id);
        if (data.t === 'nack' && data.reason === 'no-folder') setStatus('pcOffline');
      }
    }
  }).catch((e) => console.warn('[AirPic recv error]', e));
}

function addRecvItem(name) {
  const node = lib.el(`
    <div class="recv">
      <span class="recv-name"></span>
      <span class="recv-meta"></span>
      <span class="recv-bar"><span class="recv-fill"></span></span>
      <button class="recv-save" type="button" disabled>${t('recv.save', getLang())}</button>
    </div>`);
  node.querySelector('.recv-name').textContent = name;
  lib.$('#recv-list').prepend(node);
  return node;
}

function updateRecvProgress() {
  const c = recvCurrent;
  if (!c || !c.node) return;
  const got = c.chunks.reduce((n, b) => n + b.byteLength, 0);
  const fill = c.node.querySelector('.recv-fill');
  if (fill) fill.style.width = (c.size > 0 ? Math.min(100, (got / c.size) * 100) : 0).toFixed(1) + '%';
  const now = performance.now();
  if (now - (c.node._lastMeta || 0) > 120) {
    c.node._lastMeta = now;
    const meta = c.node.querySelector('.recv-meta');
    if (meta) meta.textContent = lib.fmtRate(got, now - c.start);
  }
}

function markRecvReady(c) {
  if (!c.node) return;
  c.node.classList.add('ready');
  const fill = c.node.querySelector('.recv-fill');
  if (fill) fill.style.width = '100%';
  const meta = c.node.querySelector('.recv-meta');
  if (meta) meta.textContent = c.size ? lib.fmtBytes(c.size) : '✓';
  const btn = c.node.querySelector('.recv-save');
  if (btn) {
    btn.disabled = false;
    btn.addEventListener('click', () => {
      lib.downloadBlob(c.blob, c.name);
      btn.textContent = t('recv.saved', getLang());
      btn.disabled = true;
    });
  }
}

// ---------------- thumbnails ----------------
function addThumb(file, id) {
  const node = lib.el(`
    <div class="thumb queued" data-id="${id}">
      <img alt="">
      <div class="thumb-bar"><div class="thumb-fill"></div></div>
      <div class="thumb-rate"></div>
      <div class="thumb-state">${t('sender.queued.badge', getLang())}</div>
    </div>`);
  const img = node.querySelector('img');
  const url = URL.createObjectURL(file);
  img.src = url;
  img.onload = () => URL.revokeObjectURL(url);
  lib.$('#thumbs').prepend(node);
}

function updateThumb(id, got, total, startMs) {
  const node = lib.$(`.thumb[data-id="${id}"]`);
  if (!node) return;
  const pct = total > 0 ? Math.min(100, (got / total) * 100) : 0;
  node.querySelector('.thumb-fill').style.width = pct.toFixed(1) + '%';
  const now = performance.now();
  if (now - (node._lastMeta || 0) > 120) {
    node._lastMeta = now;
    const rate = node.querySelector('.thumb-rate');
    if (rate) rate.textContent = lib.fmtRate(got, now - startMs);
  }
}

function markThumb(id, state) {
  const node = lib.$(`.thumb[data-id="${id}"]`);
  if (!node) return;
  if (state === 'done') {
    node.classList.remove('queued');
    node.classList.add('done');
    node.querySelector('.thumb-fill').style.width = '100%';
    node.querySelector('.thumb-state').textContent = t('sender.sent.badge', getLang());
  } else {
    node.classList.remove('queued');
  }
}
