/* Versão do cache: MUDAR a cada atualização, senão quem instalou o app
   continua com a versão antiga guardada no celular. */
const CACHE = 'ps26-v3';
const ASSETS = ['./','./index.html','./config.js','./jsqr.js','./manifest.json','./icone.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks =>
    Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (url.hostname.includes('hsforms')) return;   // envio ao HubSpot nunca é cacheado

  /* Rede primeiro, cache como reserva: uma correção publicada durante o evento
     chega no próximo carregamento, e o app continua abrindo sem internet. */
  e.respondWith(
    fetch(e.request)
      .then(res => {
        if (res && res.ok && e.request.method === 'GET') {
          const copia = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, copia)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(e.request).then(r => r || caches.match('./index.html')))
  );
});
