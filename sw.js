// ============================================================
//  sw.js  —  עבודה בלי רשת + טיפול בלחיצה על התראה
// ============================================================
const BUILD = '2026-09-03 20:10 v7 install-to-home';
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
  './js/push.js',
  './js/mirror.js',
  './js/install.js',
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

// ============================================================
//  שיקוף IndexedDB — כך ה-SW בונה התראה מלאה עם תמונה ושם
//  גם כשהאפליקציה סגורה, בלי ששום פרט רפואי יעבור בשרת.
// ============================================================
const IDB = { name: 'pillapp', store: 'mirror', key: 'current' };

function idbOpen() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(IDB.name, 1);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains(IDB.store)) db.createObjectStore(IDB.store);
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function idbGet() {
  return idbOpen().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(IDB.store, 'readonly');
    const req = t.objectStore(IDB.store).get(IDB.key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  })).catch(() => null);
}

function idbMark(slotId, status) {
  return idbOpen().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(IDB.store, 'readwrite');
    const store = t.objectStore(IDB.store);
    const req = store.get(IDB.key);
    req.onsuccess = () => {
      const data = req.result;
      if (data) {
        data.log = data.log || {};
        data.log[slotId] = { status: status, at: Date.now(), fromSw: true };
        store.put(data, IDB.key);
      }
      resolve(true);
    };
    req.onerror = () => reject(req.error);
  })).catch(() => false);
}

function parseYmdSw(s) {
  const a = s.split('-').map(Number);
  return new Date(a[0], a[1] - 1, a[2]);
}

function daysBetweenSw(a, b) {
  const A = new Date(a.getFullYear(), a.getMonth(), a.getDate());
  const B = new Date(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((B - A) / 86400000);
}

/** האם התרופה נלקחת בתאריך — עותק מצומצם של schedule.occursOn */
function occursOnSw(med, dateStr) {
  const s = med.schedule || {};
  if (s.type === 'asneeded') return false;
  if (s.startDate && dateStr < s.startDate) return false;
  if (s.endDate && dateStr > s.endDate) return false;
  const d = parseYmdSw(dateStr);
  if (s.type === 'weekdays') return (s.weekdays || []).indexOf(d.getDay()) !== -1;
  if (s.type === 'interval') {
    const n = Math.max(1, Number(s.intervalDays) || 1);
    const diff = daysBetweenSw(parseYmdSw(s.startDate || dateStr), d);
    return diff >= 0 && diff % n === 0;
  }
  return true;
}

function doseTextSw(med) {
  const amount = String(med.doseText || '1').trim();
  const form = med.form || 'טבליה';
  const n = Number(amount);
  const plural = { 'טבליה': 'טבליות', 'כמוסה': 'כמוסות', 'שקית': 'שקיות', 'זריקה': 'זריקות', 'מדבקה': 'מדבקות' };
  if (!isNaN(n) && n > 1) return amount + ' ' + (plural[form] || form);
  if (form === 'טיפות') return amount + ' טיפות';
  return amount + ' ' + form;
}

const COND_SHORT = {
  before_food: 'לפני אוכל', with_food: 'עם אוכל', after_food: 'אחרי אוכל',
  empty_stomach: 'קיבה ריקה', with_water: 'עם מים', bedtime: 'לפני השינה',
  morning_fast: 'בוקר בצום', none: ''
};

function condTextSw(med) {
  const base = COND_SHORT[med.condition] || '';
  const extra = (med.conditionText || '').trim();
  return base && extra ? base + ' · ' + extra : (base || extra);
}

async function serverPost(mirror, path, body) {
  const server = mirror && mirror.settings && mirror.settings.pushServer;
  const id = mirror && mirror.settings && mirror.settings.pushId;
  if (!server || !id) return;
  try {
    await fetch(server.replace(/\/+$/, '') + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ id: id }, body))
    });
  } catch (e) { /* לא קריטי */ }
}

// ---------- קבלת דחיפה ----------
self.addEventListener('push', e => {
  e.waitUntil(handlePush(e.data));
});

async function handlePush(data) {
  let p = {};
  try { p = data ? data.json() : {}; } catch (err) { p = {}; }

  if (p.test) {
    await self.registration.showNotification('🔔 בדיקת תזכורת', {
      body: 'ההתראות עובדות גם כשהאפליקציה סגורה.',
      icon: './assets/icon-192.png', badge: './assets/badge.png',
      tag: 'pushtest', dir: 'rtl', lang: 'he', vibrate: [200, 100, 200]
    });
    return;
  }

  const mirror = await idbGet();
  if (!mirror || !p.d || !p.t) {
    await self.registration.showNotification('💊 תזכורת תרופה', {
      body: 'פתחי את האפליקציה כדי לראות מה צריך לקחת.',
      icon: './assets/icon-192.png', badge: './assets/badge.png',
      tag: 'generic', dir: 'rtl', lang: 'he', requireInteraction: true, vibrate: [300, 100, 300]
    });
    return;
  }

  const name = (mirror.settings && mirror.settings.userName || '').trim();
  const fem = !(mirror.settings && mirror.settings.gender === 'm');
  const log = mirror.log || {};

  const due = (mirror.meds || []).filter(m =>
    (m.schedule.times || []).indexOf(p.t) !== -1 &&
    occursOnSw(m, p.d) &&
    !log[m.id + '|' + p.d + '|' + p.t]
  );

  if (!due.length) {
    // הכול כבר סומן. Chrome מחייב להציג משהו על כל דחיפה, אחרת הוא
    // מציג הודעה גנרית משלו ובסופו של דבר שולל את ההרשאה.
    await self.registration.showNotification('✓ הכול מסומן', {
      body: 'אין תרופה שממתינה לשעה ' + p.t + '.',
      icon: './assets/icon-192.png', badge: './assets/badge.png',
      tag: 'allclear', dir: 'rtl', lang: 'he', silent: true
    });
    await serverPost(mirror, '/api/ack', { slots: [p.d + '|' + p.t] });
    setTimeout(() => {
      self.registration.getNotifications({ tag: 'allclear' })
        .then(ns => ns.forEach(n => n.close())).catch(() => { });
    }, 4000);
    return;
  }

  const nag = Number(p.n) || 0;
  const snoozeMin = (mirror.settings && mirror.settings.snoozeOptions && mirror.settings.snoozeOptions[1]) || 10;

  for (const med of due) {
    const sid = med.id + '|' + p.d + '|' + p.t;
    const cond = condTextSw(med);
    const who = name ? name + ', ' : '';
    const verb = fem ? 'קחי' : 'קח';
    const body = who + verb + ' ' + doseTextSw(med) + (cond ? ' · ' + cond : '') +
      (nag ? '\n(תזכורת חוזרת)' : '');

    const opts = {
      body: body,
      icon: './assets/icon-192.png',
      badge: './assets/badge.png',
      tag: 'dose-' + sid,
      renotify: true,
      requireInteraction: true,
      dir: 'rtl',
      lang: 'he',
      vibrate: nag ? [400, 120, 400, 120, 400] : [300, 100, 300],
      timestamp: Date.now(),
      data: { slotId: sid, date: p.d, time: p.t, medId: med.id, kind: 'dose', snoozeMin: snoozeMin },
      actions: [
        { action: 'taken', title: '✓ לקחתי' },
        { action: 'snooze', title: '⏰ ' + snoozeMin + ' דק׳' }
      ]
    };
    if (med.photo) opts.image = med.photo;      // התמונה הגדולה של הכדור
    if (med.warning) opts.body = '⚠️ ' + med.warning + '\n' + opts.body;

    await self.registration.showNotification(p.t + ' · ' + med.name, opts);
  }
}

// ---------- לחיצה על התראה ----------
self.addEventListener('notificationclick', e => {
  const action = e.action || 'open';
  const data = e.notification.data || {};
  e.notification.close();

  e.waitUntil((async () => {
    // פעולה ישירות מההתראה — בלי לפתוח את האפליקציה
    if (data.kind === 'dose' && (action === 'taken' || action === 'snooze')) {
      const mirror = await idbGet();
      if (action === 'taken') {
        await idbMark(data.slotId, 'taken');
        await serverPost(mirror, '/api/ack', { slots: [data.date + '|' + data.time] });
      } else {
        await serverPost(mirror, '/api/snooze', {
          date: data.date, time: data.time, minutes: data.snoozeMin || 10
        });
      }
      const cs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      cs.forEach(c => c.postMessage({ type: 'action', action: action, slotId: data.slotId, kind: 'dose' }));
      return;
    }

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
  if (!e.data) return;
  if (e.data.type === 'skipWaiting') self.skipWaiting();
  // הצגת התראת דוגמה בדיוק כמו דחיפה אמיתית — לבדיקה מהמכשיר עצמו
  if (e.data.type === 'simulatePush') {
    const payload = e.data.payload || {};
    e.waitUntil(handlePush({ json: () => payload }));
  }
});
