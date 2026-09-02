// ============================================================
//  sensors.js  —  התראות מותנות: זיהוי השכמה (טלטול) ויציאה מהבית
// ============================================================
import { state, save, ymd, hm } from './store.js';
import { slotsForDate, isQuietDate } from './schedule.js';
import * as N from './notify.js';
import * as T from './text.js';

let motionOn = false;
let geoWatch = null;
let wasInsideHome = null;
let lastLeaveAlert = 0;

// ------------------------------------------------------------
//  1) השכמה לפי תנועה
// ------------------------------------------------------------
let motionSamples = [];

export async function enableMotion() {
  if (motionOn) return true;
  if (typeof DeviceMotionEvent === 'undefined') {
    throw new Error('אין חיישן תנועה במכשיר הזה (במחשב זה לא קיים).');
  }
  if (typeof DeviceMotionEvent.requestPermission === 'function') {
    const p = await DeviceMotionEvent.requestPermission();
    if (p !== 'granted') throw new Error('לא ניתנה הרשאה לחיישן התנועה.');
  }
  window.addEventListener('devicemotion', onMotion, { passive: true });
  motionOn = true;
  return true;
}

export function disableMotion() {
  window.removeEventListener('devicemotion', onMotion);
  motionOn = false;
}

export function motionEnabled() { return motionOn; }

function onMotion(ev) {
  const cfg = state.settings.wake;
  if (!cfg.enabled) return;
  const a = ev.accelerationIncludingGravity || ev.acceleration;
  if (!a) return;
  const mag = Math.sqrt((a.x || 0) ** 2 + (a.y || 0) ** 2 + (a.z || 0) ** 2);
  const now = Date.now();
  motionSamples.push({ t: now, mag: mag });
  motionSamples = motionSamples.filter(s => now - s.t < 4000);
  if (motionSamples.length < 12) return;

  // תנועה משמעותית = הפרש גדול בין קריאות, לא סתם החזקה ביד
  const mags = motionSamples.map(s => s.mag);
  const spread = Math.max.apply(null, mags) - Math.min.apply(null, mags);
  if (spread >= (cfg.sensitivity || 14)) {
    motionSamples = [];
    maybeWakeReminder();
  }
}

function maybeWakeReminder() {
  const cfg = state.settings.wake;
  const now = new Date();
  const today = ymd(now);
  const h = now.getHours();
  if (h < cfg.fromHour || h >= cfg.toHour) return;
  if (state.runtime.wakeFired === today) return;
  if (isQuietDate(today)) return;

  const morning = slotsForDate(today).filter(s => !s.status && s.at <= new Date(now.getTime() + 3 * 3600000));
  state.runtime.wakeFired = today;
  save();
  if (!morning.length) return;

  N.contextAlert(
    '☀️ ' + T.greeting(now),
    T.wakeText(morning.length) + ' ' + morning.map(s => s.med.name).join(', '),
    T.wakeText(morning.length),
    'wake'
  );
  document.dispatchEvent(new CustomEvent('pill:wake', { detail: { slots: morning } }));
}

/** לבדיקה ידנית מההגדרות */
export function testWake() {
  state.runtime.wakeFired = null;
  maybeWakeReminder();
}

// ------------------------------------------------------------
//  2) יציאה מהבית
// ------------------------------------------------------------
export function haversineM(lat1, lon1, lat2, lon2) {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad, dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export function currentPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('אין שירותי מיקום בדפדפן הזה.'));
    navigator.geolocation.getCurrentPosition(
      p => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy }),
      e => reject(new Error(geoErrText(e))),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
    );
  });
}

function geoErrText(e) {
  if (e.code === 1) return 'לא ניתנה הרשאת מיקום.';
  if (e.code === 2) return 'לא הצלחתי לאתר מיקום כרגע.';
  if (e.code === 3) return 'איתור המיקום לקח יותר מדי זמן.';
  return 'שגיאת מיקום.';
}

export async function setHomeHere() {
  const p = await currentPosition();
  state.settings.leaveHome.lat = p.lat;
  state.settings.leaveHome.lng = p.lng;
  save();
  return p;
}

export function enableGeo() {
  if (geoWatch !== null) return true;
  const cfg = state.settings.leaveHome;
  if (!navigator.geolocation) throw new Error('אין שירותי מיקום בדפדפן הזה.');
  if (cfg.lat === null) throw new Error('קודם צריך לסמן איפה הבית (בהגדרות).');
  geoWatch = navigator.geolocation.watchPosition(onPosition, () => { }, {
    enableHighAccuracy: false, timeout: 30000, maximumAge: 60000
  });
  return true;
}

export function disableGeo() {
  if (geoWatch !== null) navigator.geolocation.clearWatch(geoWatch);
  geoWatch = null;
  wasInsideHome = null;
}

export function geoEnabled() { return geoWatch !== null; }

function onPosition(p) {
  const cfg = state.settings.leaveHome;
  if (!cfg.enabled || cfg.lat === null) return;
  const d = haversineM(cfg.lat, cfg.lng, p.coords.latitude, p.coords.longitude);
  const inside = d <= (cfg.radiusM || 250);

  document.dispatchEvent(new CustomEvent('pill:geo', { detail: { distance: Math.round(d), inside: inside } }));

  if (wasInsideHome === null) { wasInsideHome = inside; return; }
  if (wasInsideHome && !inside) fireLeaveHome();
  wasInsideHome = inside;
}

function fireLeaveHome() {
  const now = new Date();
  if (now.getTime() - lastLeaveAlert < 30 * 60000) return;   // לא יותר מפעם בחצי שעה
  if (isQuietDate(ymd(now))) return;

  const horizon = new Date(now.getTime() + (state.settings.leaveHome.lookaheadHours || 10) * 3600000);
  const pending = slotsForDate(ymd(now)).filter(s => !s.status && s.at > now && s.at <= horizon);
  if (!pending.length) return;

  lastLeaveAlert = now.getTime();
  const meds = [];
  pending.forEach(s => { if (meds.indexOf(s.med) === -1) meds.push(s.med); });
  const txt = T.leaveHomeText(meds);
  N.contextAlert('🚪 יוצאים מהבית', txt + ' (' + pending.map(s => s.time).join(', ') + ')', txt, 'leavehome');
  document.dispatchEvent(new CustomEvent('pill:leavehome', { detail: { meds: meds, slots: pending } }));
}

export function testLeaveHome() { lastLeaveAlert = 0; fireLeaveHome(); }

// ------------------------------------------------------------
//  הפעלה לפי ההגדרות
// ------------------------------------------------------------
export async function applySettings() {
  const s = state.settings;
  try {
    if (s.wake.enabled && !motionOn) await enableMotion();
    if (!s.wake.enabled && motionOn) disableMotion();
  } catch (e) { console.warn('[pillApp] תנועה:', e.message); }
  try {
    if (s.leaveHome.enabled && geoWatch === null) enableGeo();
    if (!s.leaveHome.enabled && geoWatch !== null) disableGeo();
  } catch (e) { console.warn('[pillApp] מיקום:', e.message); }
}
