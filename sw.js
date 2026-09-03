// ============================================================
//  sw.js  —  עבודה בלי רשת + טיפול בלחיצה על התראה
// ============================================================
const BUILD = '2026-09-03 10:35 v4 missed-dose-catchup';
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
  './js/ics.js',
  './assets/icon-192.png',
  './assets/icon-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => Promise.all(SHELL.map(u =>
        // cache:'reload' עוקף את מטמון ה-HTTP של הדפדפן.
        // בלי זה ההתקנה יכולה למלא את המטמון החדש בקבצים ישנים,
        // והאפליקציה תריץ קוד ישן עם מספר גרסה חדש.
        c.add(new Request(u, { cache: 'reload' })).catch(() => console.warn('[sw] לא נשמר', u))
      )))
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

  // ניווט (HTML) — רשת קודם, כדי שגרסה חדשה תתגלה מיד
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(new Request(req, { cache: 'no-cache' }))
        .then(res => {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put('./index.html', copy)).catch(() => { });
          return res;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  // שאר קבצי האפליקציה — מהמטמון של הגרסה הנוכחית.
  // שם המטמון מכיל את BUILD, כך שכל פריסה יוצרת מטמון חדש שנמלא מהרשת בהתקנה.
  e.respondWith(
    caches.match(req).then(hit => hit || fetch(new Request(req, { cache: 'no-cache' })).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(req, copy)).catch(() => { });
      return res;
    }))
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
