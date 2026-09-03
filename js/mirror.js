// ============================================================
//  mirror.js  —  שיקוף הנתונים ל-IndexedDB
//  ה-Service Worker אינו יכול לקרוא localStorage, ולכן כשמגיעה
//  דחיפה והאפליקציה סגורה, הוא קורא את הנתונים מכאן ובונה
//  את ההתראה בעצמו — עם התמונה והשם, מבלי ששום דבר מזה יעבור בשרת.
// ============================================================
const DB = 'pillapp';
const STORE = 'mirror';
const KEY = 'current';

function open() {
  return new Promise((resolve, reject) => {
    if (!self.indexedDB) return reject(new Error('אין IndexedDB'));
    const req = self.indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('IndexedDB נכשל'));
  });
}

function tx(mode, fn) {
  return open().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const store = t.objectStore(STORE);
    let out;
    try { out = fn(store); } catch (e) { reject(e); return; }
    t.oncomplete = () => resolve(out && out.result !== undefined ? out.result : out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

/** מה שה-SW צריך — בלי הגדרות רגישות ובלי היסטוריה מיותרת */
export function snapshot(state) {
  return {
    at: Date.now(),
    settings: {
      userName: state.settings.userName,
      gender: state.settings.gender,
      snoozeOptions: state.settings.snoozeOptions,
      quietWeekdays: state.settings.quietWeekdays,
      quietDates: state.settings.quietDates,
      pushId: state.settings.push && state.settings.push.id,
      pushServer: state.settings.push && state.settings.push.server
    },
    meds: state.meds.filter(m => m.active).map(m => ({
      id: m.id, name: m.name, strength: m.strength, form: m.form,
      doseText: m.doseText, condition: m.condition, conditionText: m.conditionText,
      photo: m.photoMain === 'box' ? (m.photoBox || m.photoPill) : (m.photoPill || m.photoBox),
      pill: m.pill,
      warning: (m.info && m.info.redWarnings && m.info.redWarnings[0]) || '',
      schedule: m.schedule,
      createdAt: m.createdAt
    })),
    log: state.log
  };
}

export function write(state) {
  return tx('readwrite', store => store.put(snapshot(state), KEY)).catch(e => {
    console.warn('[pillApp] שיקוף נכשל:', e.message);
  });
}

export function read() {
  return tx('readonly', store => store.get(KEY));
}

/** ה-SW מסמן לקיחה — נכתב לשיקוף, והאפליקציה קולטת בפתיחה הבאה */
export function markInMirror(slotId, status) {
  return tx('readwrite', store => {
    const req = store.get(KEY);
    req.onsuccess = () => {
      const data = req.result;
      if (!data) return;
      data.log = data.log || {};
      data.log[slotId] = { status: status, at: Date.now(), fromSw: true };
      store.put(data, KEY);
    };
    return req;
  });
}

/** מיזוג סימונים שנעשו מתוך ההתראה בחזרה למצב הראשי */
export function mergeBack(state) {
  return read().then(data => {
    if (!data || !data.log) return 0;
    let n = 0;
    for (const k of Object.keys(data.log)) {
      const e = data.log[k];
      if (e && e.fromSw && !state.log[k]) {
        state.log[k] = { status: e.status, at: e.at, note: '' };
        n++;
      }
    }
    return n;
  }).catch(() => 0);
}
