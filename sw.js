const CACHE_NAME = 'neon-music-v2';
const ASSETS = [
    './',
    './index.html',
    './styles.css',
    './app.js',
    './manifest.json',
    './icon.svg'
];

self.addEventListener('install', (event) => {
    // Force the waiting service worker to become the active service worker.
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            // we catch errors here so that if an icon is missing, it doesn't break everything
            return Promise.all(
                ASSETS.map(asset => {
                    return cache.add(asset).catch(err => console.log('Skipped caching:', asset, err));
                })
            );
        })
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
    // ONLY intercept same-origin requests. 
    // This absolutely guarantees that external audio streams and APIs are NOT broken by the Service Worker.
    const url = new URL(event.request.url);
    
    if (url.origin !== location.origin) {
        return; 
    }

    event.respondWith(
        caches.match(event.request).then((cachedResponse) => {
            if (cachedResponse) {
                return cachedResponse;
            }
            // Return raw fetch to let the browser handle actual HTTP and Network errors properly
            return fetch(event.request);
        })
    );
});
