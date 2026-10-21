// Service Worker: macht den Lernomat offline nutzbar.
const VERSION = 'lernomat-v16';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'css/style.css',
  'js/vendor/anthropic-sdk-0.131.0.min.js', 'js/vendor/jszip-3.10.1.min.js',
  'js/vendor/pdfjs-4.10.38.min.mjs', 'js/vendor/pdfjs-4.10.38.worker.min.mjs', 'js/viewer.js',
  'js/app.js', 'js/ai.js', 'js/config.js', 'js/audio.js', 'js/chat.js', 'js/db.js', 'js/files.js', 'js/markdown.js', 'js/prompts.js', 'js/ui.js', 'js/owl.js', 'js/game.js', 'js/progress.js', 'js/share.js',
  'js/lena/text.js', 'js/lena/engine.js', 'js/lena/assistant.js', 'js/lena/llm.js', 'js/lena/llm-worker.js',
  'js/lena/ocr.js', 'js/lena/tips.js', 'js/lena/enhance.js',
  'audio/eule-hallo.mp3', 'icons/favicon.svg', 'icons/apple-touch-icon.png', 'icons/icon-192.png', 'icons/icon-512.png',
];
const CDN = ['cdn.jsdelivr.net', 'cdnjs.cloudflare.com'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

// Nur eigene alte Caches löschen: das Sprachmodell des Denk-Modus liegt in eigenen Caches und bleibt erhalten.
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('lernomat-') && k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Bibliotheken aus dem CDN: einmal laden, danach aus dem Cache (Versionen sind fest).
  if (CDN.includes(url.hostname)) {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
      if (res.ok) caches.open(VERSION).then(c => c.put(req, res.clone()));
      return res;
    })));
    return;
  }
  if (url.origin !== location.origin) return;
  // Eigene Dateien: erst Netz (immer frisch prüfen, damit Updates sofort ankommen), bei Offline aus dem Cache.
  e.respondWith(fetch(req, { cache: 'no-cache' }).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
    return res;
  }).catch(() => caches.match(req).then(hit => hit || caches.match('index.html'))));
});

// Tipp auf die Erinnerung: App öffnen oder nach vorn holen.
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    const open = list.find(c => c.url.startsWith(self.registration.scope));
    return open ? open.focus() : self.clients.openWindow(self.registration.scope);
  }));
});
