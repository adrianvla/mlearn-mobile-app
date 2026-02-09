const CACHE_NAME = 'srs-cache-v2';
const ASSETS = [
    '/index.html',
    '/style.css',
    '/app.js',
    '/icon-192.png',
    '/icon-512.png',
    '/lib/jquery.min.js',
    '/lib/jsqr.min.js',
    '/lib/qrcode.js',
    '/lib/simplepeer.min.js',
    '/modules/init.js',
    '/modules/common/pitchAccent.js',
    '/modules/SRS/srsAlgorithm.js',
    '/modules/SRS/storage.js',
    '/modules/SRS/review.js',
    '/modules/SRS/display.js',
    '/modules/networking/transmit.js',
    '/modules/networking/connectUsingData.js',
    '/modules/networking/showQR.js',
    '/modules/networking/startConnectionByQR.js',
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
    event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', event => {
    event.respondWith(
        caches.match(event.request, { ignoreSearch: true })
            .then(response => response || fetch(event.request).catch(() => caches.match('/index.html')))
    );
});
