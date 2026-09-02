// ============================================================
//  sw.js  —  עבודה בלי רשת + טיפול בלחיצה על התראה
// ============================================================
const BUILD = '2026-09-02 20:10 v2 first-release';
const CACHE = 'pillapp-' + BUILD;

const SHELL = [
  './',
  './index.html',
  './css/app.css',
  './manifest.webmanifest',
  './js/app.js',
  './js/store.js',
  './js/schedule.js',
  './js/text.js',
  './js/notify.js',
  './js/sensors.js',
  './js/tools.js',
  './js/gemini.js',
  './js/dom.js',
  './js/ui.js',
  './js/editors.js',
  './assets/icon-192.png',
  './assets/icon-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => Promise.all(SHELL.map(u => c.add(u).catch(err => console.warn('[sw] לא נשמר', u)))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // אף פעם לא לשמור בקאש קריאות ל-API
  if (url.hostname.indexOf('googleapis.com') !== -1 && url.hostname.indexOf('fonts.') === -1) return;

  // גופנים — קאש קודם
  if (url.hostname.indexOf('fonts.g') !== -1) {
    e.respondWith(
      caches.match(req).then(hit => hit || fetch(req).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy)).catch(() => { });
        return res;
      }).catch(() => hit))
    );
    return;
  }

  if (url.origin !== self.location.origin) return;

  // רשת קודם, קאש כגיבוי — כדי שעדכון קוד ייתפס מיד
  e.respondWith(
    fetch(req)
      .then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy)).catch(() => { });
        return res;
      })
      .catch(() => caches.match(req).then(hit => hit || caches.match('./index.html')))
  );
});

// ---------- לחיצה על התראה ----------
self.addEventListener('notificationclick', e => {
  const action = e.action || 'open';
  const data = e.notification.data || {};
  e.notification.close();

  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const msg = { type: 'action', action: action, slotId: data.slotId, kind: data.kind };

    if (all.length) {
      all[0].postMessage(msg);
      if (action === 'open' || !action) { try { await all[0].focus(); } catch (err) { } }
      return;
    }
    const client = await self.clients.openWindow('./');
    if (client) {
      // הלקוח החדש עוד לא מאזין — נותנים לו רגע
      setTimeout(() => client.postMessage(msg), 1500);
    }
  })());
});

self.addEventListener('message', e => {
  if (e.data && e.data.type === 'skipWaiting') self.skipWaiting();
});
