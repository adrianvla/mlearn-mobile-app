const CACHE_NAME = 'srs-cache-v1';
const ASSETS = [
    '/index.html',
    '/style.css',
    '/app.js',
    '/icon-192.png',
    '/icon-512.png'
];


// Send debug info to the client
function debug(message) {
    self.clients.matchAll().then(clients => {
        clients.forEach(client => client.postMessage({ type: 'debug', message }));
    });
}

self.addEventListener('install', event => {
    debug('Installing service worker and caching assets...');
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
    );
    self.skipWaiting();
});

self.addEventListener('activate', event => {
    event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', event => {
    event.respondWith(
        caches.match(event.request, { ignoreSearch: true })
            .then(response => response || fetch(event.request).catch(() => caches.match('/index.html')))
    );
});
