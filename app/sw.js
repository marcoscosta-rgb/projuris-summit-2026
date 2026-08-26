const CACHE = 'ps26-v1';
const ASSETS = ['./','./index.html','./config.js','./jsqr.js','./manifest.json','./icone.png'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks =>
    Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // nunca cacheia o envio ao HubSpot
  if (url.hostname.includes('hsforms')) return;
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
});
