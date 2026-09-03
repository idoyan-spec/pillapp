// ============================================================
//  store.js  —  מודל הנתונים + שמירה מקומית
// ============================================================
import * as Mirror from './mirror.js';

export const BUILD = '2026-09-03 21:30 v8 push-selfheal';

const KEY = 'pillapp.state.v1';

export let state = null;

const listeners = new Set();

function defaults() {
  return {
    settings: {
      userName: '',
      gender: 'f',                 // 'f' | 'm'
      fontScale: 1,
      theme: 'auto',               // auto | light | dark
      geminiKey: '',
      geminiModel: 'gemini-3.8-flash',
      voiceEnabled: true,
      voiceRate: 0.95,
      snoozeOptions: [5, 10, 20, 60],
      nagIntervalMin: 7,           // כל כמה דקות לנדנד אם לא סומן
      nagMaxHours: 5,              // עד מתי לנדנד אחרי הזמן
      quietWeekdays: [],           // 0=ראשון ... 6=שבת
      quietDates: [],              // תאריכים ידניים
      quiet: {
        maxAnnouncements: 2,       // כמה הכרזות קוליות מותר ביום שקט
        announceTimes: ['09:00', '19:00'],
        showBoard: true            // מסך שבת פסיבי
      },
      wake: {
        enabled: false,
        fromHour: 6,
        toHour: 11,
        sensitivity: 14            // סף תאוצה
      },
      leaveHome: {
        enabled: false,
        lat: null, lng: null,
        radiusM: 250,
        lookaheadHours: 10
      },
      refillWarnDays: 7,
      push: {
        enabled: false,
        server: 'https://pillapp-push.idoyan.workers.dev',   // שרת התזכורות
        id: '',            // מזהה המנוי אצל השרת
        lastSync: 0,
        lastSlot: '',      // המנה האחרונה שנרשמה — כשהיא מתקרבת צריך לפתוח ולסנכרן
        endpoint: '',
        vapidKey: ''       // דרוש ל-SW כדי לחדש מנוי שפג
      },
      lastOpened: null
    },
    meds: [],
    procedures: [],
    notes: [],
    log: {},        // slotId -> {status:'taken'|'skipped', at, note}
    runtime: {      // מצב נדנוד — נשמר כדי לשרוד רענון
      nag: {},      // slotId -> {lastAlertAt, count, snoozeUntil}
      quietSpoken: {}
    }
  };
}

function deepMerge(base, over) {
  if (over === null || over === undefined) return base;
  if (Array.isArray(base) || typeof base !== 'object' || base === null) return over;
  const out = Object.assign({}, base);
  for (const k of Object.keys(over)) out[k] = deepMerge(base[k], over[k]);
  return out;
}

export function load() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { saved = null; }
  state = saved ? deepMerge(defaults(), saved) : defaults();
  migrate();
  return state;
}

/** התאמות לנתונים שנשמרו בגרסאות קודמות */
function migrate() {
  for (const m of state.meds) {
    if (m.photo && !m.photoBox && !m.photoPill) { m.photoBox = m.photo; m.photoMain = 'box'; }
    if (!m.pill) m.pill = { color: '', shape: '', imprint: '', scored: false };
    if (!m.photoMain) m.photoMain = 'pill';
    if (m.englishName === undefined) m.englishName = '';
  }
  if (!state.settings.push.server) {
    state.settings.push.server = 'https://pillapp-push.idoyan.workers.dev';
  }
}

/** התמונה שמוצגת גדול. נופל אחורה לכל תמונה שקיימת. */
export function medPhoto(med) {
  if (!med) return '';
  const want = med.photoMain === 'box' ? med.photoBox : med.photoPill;
  return want || med.photoPill || med.photoBox || med.photo || '';
}

/** התמונה המשנית, אם יש שתיים */
export function medPhotoAlt(med) {
  if (!med) return '';
  const main = medPhoto(med);
  const other = (main === med.photoPill) ? med.photoBox : med.photoPill;
  return (other && other !== main) ? other : '';
}

/** תיאור הכדור לשורת בטיחות: "לבן · עגול · TEVA 109" */
export function pillDescription(med) {
  const p = (med && med.pill) || {};
  const bits = [];
  if (p.color) bits.push(p.color);
  if (p.shape) bits.push(p.shape);
  if (p.imprint) bits.push(p.imprint);
  return bits.join(' · ');
}

let saveTimer = null;
export function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 60);
}

let lastMirror = 0;
export function saveNow() {
  clearTimeout(saveTimer);
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    // שיקוף ל-IndexedDB כדי שה-Service Worker יוכל לבנות התראה מלאה
    // כשהאפליקציה סגורה. מרוסן — התמונות כבדות.
    if (Date.now() - lastMirror > 3000) { lastMirror = Date.now(); Mirror.write(state); }
  } catch (e) {
    console.error('[pillApp] שמירה נכשלה', e);
    document.dispatchEvent(new CustomEvent('pill:toast', {
      detail: { text: 'אין מקום לשמור. כדאי למחוק תמונות של תרופות ישנות.', kind: 'error' }
    }));
  }
  listeners.forEach(fn => fn(state));
}

export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function emit() { listeners.forEach(fn => fn(state)); }

// ---------- עזרי מזהים ותאריכים ----------
export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

const pad = n => String(n).padStart(2, '0');

export function ymd(d) {
  d = d || new Date();
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}
export function hm(d) {
  d = d || new Date();
  return pad(d.getHours()) + ':' + pad(d.getMinutes());
}
export function parseYmd(s) {
  const parts = s.split('-').map(Number);
  return new Date(parts[0], parts[1] - 1, parts[2]);
}
export function atTime(dateStr, timeStr) {
  const d = dateStr.split('-').map(Number);
  const t = timeStr.split(':').map(Number);
  return new Date(d[0], d[1] - 1, d[2], t[0], t[1], 0, 0);
}
export function addDays(d, n) { const c = new Date(d); c.setDate(c.getDate() + n); return c; }
export function daysBetween(a, b) {
  const A = new Date(a.getFullYear(), a.getMonth(), a.getDate());
  const B = new Date(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((B - A) / 86400000);
}

export const slotId = (medId, dateStr, time) => medId + '|' + dateStr + '|' + time;

// ---------- CRUD ----------
const PALETTE = ['#2f7d76', '#b4531f', '#4a5a9c', '#8a5a2b', '#6b4a86', '#1f6f8b', '#8a2f4a', '#3d6b3d'];
export function pickColor() {
  const used = ((state && state.meds) || []).map(m => m.color);
  return PALETTE.find(c => used.indexOf(c) === -1) || PALETTE[Math.floor(Math.random() * PALETTE.length)];
}

export function newMed(partial) {
  return Object.assign({
    id: uid(),
    name: '',
    englishName: '',
    genericName: '',
    strength: '',
    form: 'טבליה',
    doseText: '1',
    photoBox: '',                 // תמונת האריזה
    photoPill: '',                // תמונת הכדור עצמו
    photoMain: 'pill',            // מה מוצג גדול בתזכורת: 'pill' | 'box'
    pill: { color: '', shape: '', imprint: '', scored: false },
    color: pickColor(),
    schedule: { type: 'daily', times: ['08:00'], weekdays: [0, 1, 2, 3, 4, 5, 6], intervalDays: 1, startDate: ymd() },
    condition: 'none',
    conditionText: '',
    notes: '',
    supply: { countOnHand: null, unitsPerDose: 1, lastRefill: null, packSize: null },
    info: null,
    infoFetchedAt: null,
    active: true,
    createdAt: Date.now()
  }, partial || {});
}

export function getMed(id) { return state.meds.find(m => m.id === id); }
export function upsertMed(med) {
  const i = state.meds.findIndex(m => m.id === med.id);
  if (i >= 0) state.meds[i] = med; else state.meds.push(med);
  save();
}
export function deleteMed(id) {
  state.meds = state.meds.filter(m => m.id !== id);
  Object.keys(state.log).forEach(k => { if (k.indexOf(id + '|') === 0) delete state.log[k]; });
  save();
}

export function newProcedure(partial) {
  return Object.assign({
    id: uid(), title: '', kind: 'blood_test', dueDate: ymd(addDays(new Date(), 30)),
    repeatMonths: 0, linkedMedId: '', notes: '', done: false, remindDaysBefore: 7
  }, partial || {});
}
export function upsertProcedure(p) {
  const i = state.procedures.findIndex(x => x.id === p.id);
  if (i >= 0) state.procedures[i] = p; else state.procedures.push(p);
  save();
}
export function deleteProcedure(id) {
  state.procedures = state.procedures.filter(p => p.id !== id);
  save();
}

// ---------- סימון לקיחה ----------
export function markSlot(sid, status, note) {
  state.log[sid] = { status: status, at: Date.now(), note: note || '' };
  const medId = sid.split('|')[0];
  const med = getMed(medId);
  if (status === 'taken' && med && typeof med.supply.countOnHand === 'number') {
    med.supply.countOnHand = Math.max(0, med.supply.countOnHand - (Number(med.supply.unitsPerDose) || 1));
  }
  delete state.runtime.nag[sid];
  save();
  document.dispatchEvent(new CustomEvent('pill:marked', { detail: { slotId: sid, status: status } }));
}
export function unmarkSlot(sid) {
  const prev = state.log[sid];
  const medId = sid.split('|')[0];
  const med = getMed(medId);
  if (prev && prev.status === 'taken' && med && typeof med.supply.countOnHand === 'number') {
    med.supply.countOnHand += (Number(med.supply.unitsPerDose) || 1);
  }
  delete state.log[sid];
  save();
}

// ---------- ייצוא / ייבוא ----------
export function exportJson() {
  return JSON.stringify({ _app: 'pillApp', _build: BUILD, _at: new Date().toISOString(), state: state }, null, 2);
}
export function importJson(text) {
  const parsed = JSON.parse(text);
  const incoming = parsed.state || parsed;
  state = deepMerge(defaults(), incoming);
  saveNow();
}
