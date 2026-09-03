// ============================================================
//  push.js  —  הרשמה לדחיפות וסנכרון לוח הזמנים לשרת
//
//  לשרת עוברים רק: מנוי דחיפה טכני, אזור זמן, ורשימת "תאריך|שעה".
//  שמות תרופות, מינונים ותמונות לא עוזבים את הטלפון — ההתראה עצמה
//  נבנית ב-Service Worker מתוך השיקוף המקומי ב-IndexedDB.
// ============================================================
import { state, save, ymd, addDays, slotId } from './store.js';
import { slotsForDate, isQuietDate } from './schedule.js';
import * as Mirror from './mirror.js';
import { BUILD as BUILD_TAG } from './store.js';

const DAYS_AHEAD = 21;

export let lastServerInfo = null;

export function supported() {
  return ('serviceWorker' in navigator) && ('PushManager' in window) && ('Notification' in window);
}

function cfg() { return state.settings.push; }

function serverUrl(path) {
  const base = (cfg().server || '').replace(/\/+$/, '');
  if (!base) throw new Error('לא הוגדרה כתובת שרת התזכורות.');
  return base + path;
}

function b64ToU8(s) {
  s = String(s).replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}

async function api(path, body) {
  const res = await fetch(serverUrl(path), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || ('השרת החזיר שגיאה ' + res.status));
  return data;
}

/** כל המנות של השבועות הקרובים, כ־"YYYY-MM-DD|HH:MM" */
export function upcomingSlots(days) {
  days = days || DAYS_AHEAD;
  const out = [];
  const now = new Date();
  const seen = {};
  for (let i = 0; i < days; i++) {
    const d = addDays(now, i);
    const ds = ymd(d);
    if (isQuietDate(ds)) continue;               // ימים שקטים — בלי דחיפות בכלל
    for (const s of slotsForDate(ds)) {
      if (i === 0 && s.at <= now) continue;      // מה שכבר עבר היום
      const key = ds + '|' + s.time;
      if (seen[key]) continue;
      seen[key] = 1;
      out.push(key);
    }
  }
  out.sort();
  return out.slice(0, 600);
}

export async function status() {
  const st = {
    supported: supported(),
    permission: ('Notification' in window) ? Notification.permission : 'unsupported',
    server: cfg().server || '',
    id: cfg().id || '',
    enabled: !!cfg().enabled,
    subscribed: false,
    lastSync: cfg().lastSync || 0,
    lastSlot: cfg().lastSlot || ''
  };
  if (!st.supported) return st;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    if (reg) {
      const sub = await reg.pushManager.getSubscription();
      st.subscribed = !!sub;
      if (sub) st.endpointHost = new URL(sub.endpoint).host;
    }
  } catch (e) { /* ignore */ }
  return st;
}

/** בדיקה שהשרת חי ומוגדר */
export async function checkServer(url) {
  const base = (url || cfg().server || '').replace(/\/+$/, '');
  if (!base) throw new Error('לא הוגדרה כתובת שרת.');
  const res = await fetch(base + '/api/version');
  if (!res.ok) throw new Error('השרת לא ענה (' + res.status + ')');
  const j = await res.json();
  if (!j.hasKeys) throw new Error('השרת עונה אבל מפתחות ה-VAPID לא הוגדרו בו.');
  lastServerInfo = j;
  return j;
}

export async function enable(url) {
  if (!supported()) throw new Error('הדפדפן הזה לא תומך בדחיפות.');
  if (url) { cfg().server = url.replace(/\/+$/, ''); save(); }

  await checkServer();

  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('בלי אישור התראות אי אפשר לשלוח תזכורות.');

  const vres = await fetch(serverUrl('/api/vapid'));
  const vjson = await vres.json();
  if (!vjson.publicKey) throw new Error('השרת לא החזיר מפתח VAPID.');

  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (sub) {
    // אם המפתח השתנה, צריך להירשם מחדש
    const cur = sub.options && sub.options.applicationServerKey;
    if (cur) {
      const curB64 = btoa(String.fromCharCode.apply(null, new Uint8Array(cur)))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      if (curB64 !== vjson.publicKey) { await sub.unsubscribe(); sub = null; }
    }
  }
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: b64ToU8(vjson.publicKey)
    });
  }

  cfg().enabled = true;
  cfg().endpoint = sub.endpoint;
  cfg().vapidKey = vjson.publicKey;   // ה-Service Worker צריך אותו כדי לחדש מנוי שפג
  save();
  return sync(sub);
}

/** מסנכרן את לוח המנות לשרת. נקרא בכל פתיחה ובכל שינוי תרופות. */
export async function sync(existingSub) {
  const c = cfg();
  if (!c.enabled || !c.server) return null;
  if (!supported()) return null;

  const reg = await navigator.serviceWorker.ready;
  let sub = existingSub || await reg.pushManager.getSubscription();

  // ריפוי עצמי: מנוי יכול לפוג (למשל אחרי התקנה למסך הבית או ניקוי נתונים).
  // אם ההרשאה קיימת ויש לנו את המפתח — נרשמים מחדש בשקט, בלי להטריד.
  if (!sub && Notification.permission === 'granted' && c.vapidKey) {
    try {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true, applicationServerKey: b64ToU8(c.vapidKey)
      });
      c.endpoint = sub.endpoint; save();
    } catch (e) { /* ניפול לשגיאה למטה */ }
  }
  // לא מכבים כאן את enabled — כיבוי שקט הפך כשל זמני לכשל קבוע.
  // heal() הוא זה שמחליט מה לעשות.
  if (!sub) throw new Error('המנוי לדחיפות אבד. צריך להפעיל מחדש.');

  const slots = upcomingSlots();
  const res = await api('/api/register', {
    id: c.id || undefined,
    subscription: sub.toJSON(),
    tz: (Intl.DateTimeFormat().resolvedOptions().timeZone) || 'Asia/Jerusalem',
    slots: slots,
    nag: { intervalMin: state.settings.nagIntervalMin, maxHours: state.settings.nagMaxHours },
    quietWeekdays: state.settings.quietWeekdays
  });

  c.id = res.id;
  c.lastSync = Date.now();
  c.lastSlot = res.lastSlot || '';
  save();
  await Mirror.write(state);
  return res;
}

/**
 * נקודת הכניסה היחידה לתחזוקת הדחיפות בפתיחת האפליקציה.
 * חייבת לא לזרוק ולא להיות תלויה בדגלים מקומיים — הניסיון הראה
 * ששתי התלויות האלה הפכו כשל זמני לכשל קבוע ושקט.
 * @returns {{ok:boolean, healed?:boolean, problem?:string, status?:object}}
 */
export async function heal() {
  const c = cfg();
  if (!supported()) return { ok: false, problem: 'הדפדפן לא תומך בדחיפות' };
  if (!c.server) return { ok: false, problem: 'לא הוגדר שרת' };
  if (Notification.permission !== 'granted') {
    return { ok: false, problem: 'ההתראות לא מאושרות' };
  }

  let status = null;
  if (c.id) {
    try {
      const res = await fetch(serverUrl('/api/status') + '?id=' + encodeURIComponent(c.id));
      status = await res.json();
      lastStatus = status;
    } catch (e) { return { ok: false, problem: 'אין קשר לשרת' }; }
  }

  const reg = await navigator.serviceWorker.ready;
  let sub = null;
  try { sub = await reg.pushManager.getSubscription(); } catch (e) { /* ignore */ }

  const serverBroken = !c.id || !status || !status.exists || status.dead;
  const endpointChanged = sub && c.endpoint && sub.endpoint !== c.endpoint;

  // מנוי מת בשרת, או שאין מנוי בדפדפן -> מנוי חדש לגמרי
  if (!sub || (status && status.dead)) {
    try {
      await resubscribe();
      await report({ event: 'healed', had: sub ? 'stale' : 'none' });
      return { ok: true, healed: true };
    } catch (e) {
      c.enabled = false; save();
      return { ok: false, problem: e.message };
    }
  }

  // מנוי חי אבל השרת לא מכיר אותו, או שהכתובת השתנתה -> רישום מחדש
  if (serverBroken || endpointChanged) {
    try { await sync(sub); return { ok: true, healed: true }; }
    catch (e) { return { ok: false, problem: e.message }; }
  }

  // הכול תקין — רק מרעננים את לוח המנות
  try { await sync(sub); } catch (e) { /* לא קריטי */ }
  return { ok: true, status: status };
}

/** דיווח אבחון קצר לשרת. בלי שום פרט רפואי — רק מצב טכני. */
export async function report(extra) {
  const c = cfg();
  if (!c.server || !c.id) return;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = reg && await reg.pushManager.getSubscription();
    await fetch(serverUrl('/api/diag'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({
        id: c.id,
        build: BUILD_TAG,
        perm: Notification.permission,
        hasSub: !!sub,
        standalone: window.matchMedia('(display-mode: standalone)').matches,
        enabled: !!c.enabled,
        ua: (navigator.userAgent || '').slice(0, 120)
      }, extra || {}))
    });
  } catch (e) { /* אבחון בלבד */ }
}

/**
 * מנוי שפג לא מתרפא ברישום מחדש של אותו endpoint — צריך לזרוק אותו
 * ולהירשם מחדש, אחרת מקבלים 410 שוב ושוב.
 */
export async function resubscribe() {
  const c = cfg();
  if (!supported()) throw new Error('אין תמיכה בדפדפן הזה.');
  if (Notification.permission !== 'granted') {
    const p = await Notification.requestPermission();
    if (p !== 'granted') throw new Error('צריך לאשר התראות.');
  }
  let key = c.vapidKey;
  if (!key) {
    const vres = await fetch(serverUrl('/api/vapid'));
    const vjson = await vres.json();
    key = vjson.publicKey;
    c.vapidKey = key;
  }
  const reg = await navigator.serviceWorker.ready;
  const old = await reg.pushManager.getSubscription();
  if (old) { try { await old.unsubscribe(); } catch (e) { /* ignore */ } }
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true, applicationServerKey: b64ToU8(key)
  });
  c.enabled = true;
  c.endpoint = sub.endpoint;
  save();
  return sync(sub);
}

/**
 * בודק מול השרת שהוא באמת מסוגל לשלוח, ומרפא אם לא.
 * זה מה שמונע את המצב שבו הממשק מראה "פעיל" בזמן ששום תזכורת לא תגיע.
 */
export async function verify(heal) {
  const c = cfg();
  if (!c.enabled || !c.server || !c.id) return { exists: false, enabled: false };
  let st;
  try {
    const res = await fetch(serverUrl('/api/status') + '?id=' + encodeURIComponent(c.id));
    st = await res.json();
  } catch (e) { return { error: e.message }; }

  lastStatus = st;
  const broken = !st.exists || st.dead;
  if (broken && heal !== false) {
    try {
      // מנוי מת -> מנוי חדש לגמרי. חסר בשרת -> מספיק רישום מחדש.
      const r = st.dead ? await resubscribe() : await sync();
      st = { exists: true, healed: true, slots: r && r.slots };
      lastStatus = st;
    } catch (e) { st.healError = e.message; }
  }
  return st;
}

export let lastStatus = null;

export async function disable() {
  const c = cfg();
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = reg && await reg.pushManager.getSubscription();
    if (sub) await sub.unsubscribe();
  } catch (e) { /* ignore */ }
  try { if (c.id) await api('/api/unregister', { id: c.id }); } catch (e) { /* ignore */ }
  c.enabled = false; c.id = ''; c.endpoint = ''; c.lastSlot = '';
  save();
}

/** מפסיק נדנוד על מנה שסומנה */
export async function ack(slotKeys) {
  const c = cfg();
  if (!c.enabled || !c.id) return;
  try { await api('/api/ack', { id: c.id, slots: slotKeys }); } catch (e) { /* לא קריטי */ }
}

export async function snooze(dateStr, time, minutes) {
  const c = cfg();
  if (!c.enabled || !c.id) return;
  try { await api('/api/snooze', { id: c.id, date: dateStr, time: time, minutes: minutes }); } catch (e) { /* ignore */ }
}

export async function testPush() {
  const c = cfg();
  if (!c.enabled || !c.id) throw new Error('התזכורות בשרת לא מופעלות.');
  return api('/api/test', { id: c.id });
}

/** מציג התראה כמו דחיפה אמיתית, בלי לעבור דרך השרת — לבדיקת מראה */
export async function simulate(dateStr, time) {
  if (!supported()) throw new Error('אין תמיכה בדפדפן הזה.');
  if (Notification.permission !== 'granted') {
    const p = await Notification.requestPermission();
    if (p !== 'granted') throw new Error('צריך לאשר התראות.');
  }
  const reg = await navigator.serviceWorker.ready;
  await Mirror.write(state);
  if (!reg.active) throw new Error('ה-Service Worker לא פעיל.');
  reg.active.postMessage({ type: 'simulatePush', payload: { d: dateStr, t: time, n: 0 } });
}

/** ממיר slotId פנימי ל-"date|time" של השרת */
export function serverKeyOf(sid) {
  const parts = sid.split('|');
  return parts[1] + '|' + parts[2];
}
