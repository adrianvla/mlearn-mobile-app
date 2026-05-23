const CACHE_NAME = 'srs-cache-v3';
const ASSETS = [
    '/index.html',
    '/style.css',
    '/app.js',
    '/icon-192.png',
    '/icon-512.png',
    '/lib/jquery.min.js',
    '/lib/jsqr.min.js',
    '/lib/qrcode.js',
    '/modules/init.js',
    '/modules/common/pitchAccent.js',
    '/modules/SRS/srsAlgorithm.js',
    '/modules/SRS/storage.js',
    '/modules/SRS/review.js',
    '/modules/SRS/display.js',
    '/modules/networking/workerSync.js',
    '/modules/networking/showQR.js',
    '/modules/screens/home.js',
    '/modules/screens/displayScreen.js',
    '/modules/screens/settings.js',

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
    event.waitUntil(
        caches.keys().then(names => {
            return Promise.all(
                names.filter(n => n !== CACHE_NAME).map(n => caches.delete(n))
            );
        })
    );
    event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);
    const isApiCall = url.hostname !== self.location.hostname || url.pathname.startsWith('/api/');

    if (isApiCall) {
        return;
    }

    event.respondWith(
        caches.match(event.request, { ignoreSearch: true })
            .then(response => response || fetch(event.request).catch(() => caches.match('/index.html')))
    );
});
