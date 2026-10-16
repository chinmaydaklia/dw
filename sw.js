/* DoctorWealth Books service worker: the whole app (code + bundled libraries) is cached so it opens and
   works with no network. A new version waits until the user taps "Reload" in the app. */
const VERSION = '1.4.0';
const CACHE = 'dwb-' + VERSION;
const SHELL = [
  './', './index.html', './manifest.webmanifest', './css/app.css',
  './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png',
  './js/main.js',
  './js/app/app.js', './js/app/db.js', './js/app/store.js',
  './js/core/books.js', './js/core/demo.js', './js/core/integrity.js', './js/core/invest.js', './js/core/legacy.js', './js/core/masters.js', './js/core/quick.js', './js/core/recurring.js', './js/core/sync.js', './js/core/taxrules.js', './js/core/vouchers.js',
  './js/import/libs.js', './js/import/statement-parse.js', './js/import/statement-plan.js', './js/import/zerodha.js', './js/import/zerodha-plan.js',
  './js/lib/crypto.js', './js/lib/dates.js', './js/lib/money.js', './js/lib/qr.js', './js/lib/util.js',
  './js/ui/charts.js', './js/ui/dom.js', './js/ui/pickers.js', './js/ui/terms.js', './js/ui/widgets.js',
  './js/views/daybook.js', './js/views/dashboard.js', './js/views/entry.js', './js/views/family.js', './js/views/importer.js', './js/views/invest.js', './js/views/masters.js', './js/views/reports.js', './js/views/settings.js', './js/views/sync.js',
  './vendor/xlsx.full.min.js', './vendor/pdfjs/pdf.min.js', './vendor/pdfjs/pdf.worker.min.js', './vendor/jsqr/jsQR.min.js'
];

self.addEventListener('install', e => {
  /* cache:'reload' bypasses the browser's HTTP cache, so a new version can never be filled with stale
     copies of old files (that mix made old code open a newer database: "requested version 1 < existing 2") */
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })))));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('dwb-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('message', e => { if (e.data === 'skipWaiting') self.skipWaiting(); });
/* cache first for the app shell (offline by design); same-origin only */
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(caches.match(req, { ignoreSearch: true }).then(hit => hit || fetch(req).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
    return res;
  }).catch(() => (req.mode === 'navigate' ? caches.match('./index.html') : Response.error()))));
});
