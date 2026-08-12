// app/sender.js — phone side: connect to room, pick/capture photos, send in 16KB chunks with backpressure.
import * as lib from './lib.js?v=3';
import { t, getLang } from './i18n.js?v=3';

const CHUNK = 16 * 1024;          // 16 KiB — safe under SCTP message-size limits
const LOW = 1 << 20;              // 1 MiB bufferedAmountLowThreshold

let peer = null;
let conn = null;
let queue = [];
let busy = false;
let seq = 0;
let sentCount = 0;
const ackWaiters = new Map();     // id -> { resolve, timer }

export function initSender(roomId) {
  setStatus('connecting');

  peer = lib.newPeer(); // random id

  peer.on('open', () => connectWithRetry(roomId));

  peer.on('disconnected', () => { try { peer.reconnect(); } catch {} });

  peer.on('error', (err) => {
    console.warn('[AirPic peer error]', err && err.type, err && err.message);
    // 'peer-unavailable' (stale QR / PC not ready) is handled by connectWithRetry's timer.
    setStatus('error');
  });

  // inputs
  lib.$('#camera-input').addEventListener('change', onPick);
  lib.$('#gallery-input').addEventListener('change', onPick);

  document.addEventListener('langchange', () => {
    setStatus(lastState);
    updateSentCount();
  });
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

// --- connect, retrying briefly in case the PC is still registering with the broker ---
function connectWithRetry(roomId, attempt = 0) {
  conn = peer.connect(roomId, { reliable: true }); // PeerJS default serialization (objects + ArrayBuffer)

  conn.on('open', () => { setStatus('connected'); drain(); });

  conn.on('data', onData);

  conn.on('close', () => { setStatus('disconnected'); conn = null; });

  conn.on('error', (e) => console.warn('[AirPic conn error]', e));

  // if the channel never opens (PC not online / stale QR), retry a few times
  const openTimer = setTimeout(() => {
    if (!conn || !conn.open) {
      if (attempt < 6) {
        try { conn && conn.close && conn.close(); } catch {}
        setTimeout(() => connectWithRetry(roomId, attempt + 1), 900);
      } else {
        setStatus('pcOffline');
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
    if (!conn || !conn.open) break; // will resume when the channel (re)opens
    const job = queue.shift();
    await sendFile(job.id, job.file);
  }
  busy = false;
  if (conn && conn.open && !queue.length) setStatus('connected');
}

function sendFile(id, file) {
  return new Promise(async (resolve) => {
    const name = file.name || `photo-${id}`;
    const mime = file.type || 'image/*';
    const size = file.size;

    if (!conn || !conn.open) { queue.unshift({ id, file }); resolve(); return; }

    const dc = conn.dataChannel;
    if (dc) dc.bufferedAmountLowThreshold = LOW;

    let buf;
    try {
      buf = await file.arrayBuffer();
    } catch (e) {
      console.warn('[AirPic read failed]', e);
      markThumb(id, 'error');
      resolve();
      return;
    }

    setStatus('sending');
    safeSend({ t: 'meta', id, name, size, mime });

    const total = buf.byteLength;
    let offset = 0;

    await new Promise((pResolve) => {
      const pump = () => {
        while (offset < total) {
          if (dc && dc.bufferedAmount > LOW) {
            // channel saturated — wait for it to drain, then resume
            dc.addEventListener('bufferedamountlow', pump, { once: true });
            return;
          }
          const end = Math.min(offset + CHUNK, total);
          try {
            conn.send(buf.slice(offset, end)); // ArrayBuffer chunk
          } catch (e) {
            console.warn('[AirPic send chunk failed]', e);
            pResolve();
            return;
          }
          offset = end;
          updateThumb(id, offset, total);
        }
        // all chunks queued → announce end, wait for disk-ack (bounded by a timeout)
        safeSend({ t: 'end', id });
        const slot = {};
        ackWaiters.set(id, slot);
        slot.resolve = () => { ackWaiters.delete(id); pResolve(); };
        slot.timer = setTimeout(() => {
          if (ackWaiters.has(id)) { ackWaiters.delete(id); pResolve(); }
        }, 60000);
      };
      pump();
    });

    markThumb(id, 'done');
    sentCount += 1;
    updateSentCount();
    resolve();
  });
}

function onData(data) {
  if (!data || typeof data !== 'object') return; // ignore stray binary (we only expect ack/nack objects here)
  if (data.t === 'ack' || data.t === 'nack') {
    const slot = ackWaiters.get(data.id);
    if (slot) {
      clearTimeout(slot.timer);
      slot.resolve();
    }
    if (data.t === 'nack' && data.reason === 'no-folder') {
      setStatus('pcOffline'); // PC has no folder chosen
    }
  }
}

function safeSend(obj) {
  try { if (conn && conn.open) conn.send(obj); } catch (e) { console.warn('[AirPic send]', e); }
}

// ---------------- thumbnails ----------------
function addThumb(file, id) {
  const node = lib.el(`
    <div class="thumb queued" data-id="${id}">
      <img alt="">
      <div class="thumb-bar"><div class="thumb-fill"></div></div>
      <div class="thumb-state">${t('sender.queued.badge', getLang())}</div>
    </div>`);
  const img = node.querySelector('img');
  const url = URL.createObjectURL(file);
  img.src = url;
  img.onload = () => URL.revokeObjectURL(url);
  lib.$('#thumbs').prepend(node);
}

function updateThumb(id, got, total) {
  const node = lib.$(`.thumb[data-id="${id}"]`);
  if (!node) return;
  const pct = total > 0 ? Math.min(100, (got / total) * 100) : 0;
  node.querySelector('.thumb-fill').style.width = pct.toFixed(1) + '%';
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
