// app/main.js — bootstrap: language, role routing (receiver vs sender).
import { apply, getLang, setLang } from './i18n.js?v=19';
import * as lib from './lib.js?v=19';
import { initReceiver } from './receiver.js?v=19';
import { initSender } from './sender.js?v=19';

function refreshToggle() {
  const toggle = lib.$('#lang-toggle');
  if (toggle) toggle.textContent = getLang() === 'zh' ? 'EN' : '中';
}

function init() {
  apply();            // paint all static [data-i18n] strings in the detected language
  refreshToggle();

  const toggle = lib.$('#lang-toggle');
  toggle.addEventListener('click', () => {
    setLang(getLang() === 'zh' ? 'en' : 'zh');
    refreshToggle();
  });

  const roomId = lib.roomIdFromHash();
  if (roomId) {
    // ---- phone (sender) ----
    document.body.classList.remove('role-receiver');
    document.body.classList.add('role-sender');
    lib.hide(lib.$('#view-receiver'));
    lib.show(lib.$('#view-sender'));
    initSender(roomId);
  } else {
    // ---- computer (receiver) ----
    document.body.classList.remove('role-sender');
    document.body.classList.add('role-receiver');
    lib.hide(lib.$('#view-sender'));
    lib.show(lib.$('#view-receiver'));
    initReceiver();
  }

  window.__airpicReady = true;
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
