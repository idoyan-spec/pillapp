// ============================================================
//  notify.js  —  מנוע התזכורות: נדנוד, נודניק, קול, ימים שקטים
// ============================================================
import { state, save, ymd, hm, slotId, getMed } from './store.js';
import { overdueSlots, slotsForDate, isQuietDate, lowSupplyMeds, alertingProcedures, procedureState } from './schedule.js';
import * as T from './text.js';

let swReg = null;
let ticker = null;
let wakeLock = null;
let audioCtx = null;
let voicesReady = false;

// ------------------------------------------------------------
//  הרשאות ואתחול
// ------------------------------------------------------------
export async function init(registration) {
  swReg = registration || null;
  if ('speechSynthesis' in window) {
    speechSynthesis.getVoices();
    speechSynthesis.onvoiceschanged = () => { voicesReady = true; };
  }
  if (navigator.serviceWorker) {
    navigator.serviceWorker.addEventListener('message', onSwMessage);
  }
  start();
}

export async function requestPermission() {
  if (!('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'granted') return 'granted';
  try { return await Notification.requestPermission(); } catch (e) { return 'denied'; }
}

export function permission() {
  return ('Notification' in window) ? Notification.permission : 'unsupported';
}

/** מפעיל את מנועי הקול/השמע אחרי מגע ראשון של המשתמש (דרישת דפדפן) */
export function primeMedia() {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  } catch (e) { /* ignore */ }
  try {
    if ('speechSynthesis' in window && !voicesReady) {
      const u = new SpeechSynthesisUtterance(' ');
      u.volume = 0; speechSynthesis.speak(u);
    }
  } catch (e) { /* ignore */ }
}

// ------------------------------------------------------------
//  צליל נעים (מסונתז — בלי קבצים)
// ------------------------------------------------------------
export function chime(kind) {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const now = audioCtx.currentTime;
    const notes = kind === 'success' ? [659.25, 880.0]
      : kind === 'urgent' ? [523.25, 622.25, 523.25]
        : [587.33, 783.99];
    notes.forEach((f, i) => {
      const o = audioCtx.createOscillator();
      const gn = audioCtx.createGain();
      o.type = 'sine';
      o.frequency.value = f;
      const t0 = now + i * 0.18;
      gn.gain.setValueAtTime(0.0001, t0);
      gn.gain.exponentialRampToValueAtTime(0.16, t0 + 0.04);
      gn.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.9);
      o.connect(gn); gn.connect(audioCtx.destination);
      o.start(t0); o.stop(t0 + 1.0);
    });
  } catch (e) { /* ignore */ }
}

// ------------------------------------------------------------
//  קול
// ------------------------------------------------------------
export function speak(text, force) {
  if (!state.settings.voiceEnabled && !force) return;
  if (!('speechSynthesis' in window)) return;
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'he-IL';
    u.rate = Number(state.settings.voiceRate) || 0.95;
    u.pitch = 1.0;
    const v = speechSynthesis.getVoices().find(x => /he|iw/i.test(x.lang));
    if (v) u.voice = v;
    speechSynthesis.speak(u);
  } catch (e) { /* ignore */ }
}

export function stopSpeaking() {
  try { speechSynthesis.cancel(); } catch (e) { /* ignore */ }
}

// ------------------------------------------------------------
//  התראת מערכת
// ------------------------------------------------------------
async function systemNotify(opts) {
  if (permission() !== 'granted') return false;
  const payload = {
    body: opts.body,
    icon: 'assets/icon-192.png',
    badge: 'assets/badge.png',
    tag: opts.tag || 'pill',
    renotify: true,
    requireInteraction: !!opts.sticky,
    vibrate: opts.sticky ? [200, 100, 200, 100, 200] : [120, 60, 120],
    data: opts.data || {},
    actions: opts.actions || []
  };
  try {
    if (swReg) { await swReg.showNotification(opts.title, payload); return true; }
    new Notification(opts.title, payload);
    return true;
  } catch (e) {
    console.warn('[pillApp] התראה נכשלה', e);
    return false;
  }
}

function onSwMessage(ev) {
  const d = ev.data || {};
  if (d.type === 'action') {
    document.dispatchEvent(new CustomEvent('pill:swaction', { detail: d }));
  }
}

// ------------------------------------------------------------
//  לולאת הבדיקה
// ------------------------------------------------------------
export function start() {
  stop();
  tick();
  ticker = setInterval(tick, 15000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
}
export function stop() { if (ticker) clearInterval(ticker); ticker = null; }

let lastDailyCheck = '';

export function tick() {
  const now = new Date();
  const today = ymd(now);
  const quiet = isQuietDate(today);

  if (quiet) {
    quietDayTick(now, today);
  } else {
    doseTick(now);
  }

  if (lastDailyCheck !== today) {
    lastDailyCheck = today;
    setTimeout(() => { supplyTick(now); procedureTick(now); }, 2500);
  }

  document.dispatchEvent(new CustomEvent('pill:tick', { detail: { now: now } }));
}

// ---------- מנות רגילות + נדנוד ----------
function doseTick(now) {
  // אם תזכורת גדולה כבר פתוחה על המסך — לא מציפים בעוד אחת
  const open = document.querySelector('#reminder');
  if (open && !open.classList.contains('hidden') && document.visibilityState === 'visible') return;

  const due = overdueSlots(now);
  const nagMs = (state.settings.nagIntervalMin || 7) * 60000;
  let changed = false;

  for (const slot of due) {
    const n = state.runtime.nag[slot.id] || { count: 0, lastAlertAt: 0, snoozeUntil: 0 };
    if (n.snoozeUntil && now.getTime() < n.snoozeUntil) continue;
    if (n.lastAlertAt && (now.getTime() - n.lastAlertAt) < nagMs) continue;

    fireReminder(slot, n.count);
    n.count += 1;
    n.lastAlertAt = now.getTime();
    n.snoozeUntil = 0;
    state.runtime.nag[slot.id] = n;
    changed = true;
    break; // תזכורת אחת בכל פעם — לא מציפים
  }
  if (changed) save();
}

function fireReminder(slot, nagCount) {
  const med = slot.med;
  const isNag = nagCount > 0;
  const title = isNag ? T.nagTitle(med, nagCount - 1) : T.reminderTitle(med, slot.id);
  const body = med.name + ' · ' + T.doseText(med) + (T.conditionText(med) ? ' · ' + T.conditionText(med) : '');

  chime(isNag ? 'urgent' : 'gentle');

  if (document.visibilityState === 'visible') {
    document.dispatchEvent(new CustomEvent('pill:reminder', { detail: { slot: slot, nagCount: nagCount } }));
  } else {
    systemNotify({
      title: title,
      body: body,
      tag: 'dose-' + slot.id,
      sticky: true,
      data: { kind: 'dose', slotId: slot.id },
      actions: [
        { action: 'taken', title: '✓ לקחתי' },
        { action: 'snooze', title: '⏰ עוד 10 דק׳' }
      ]
    });
  }
  speak(isNag ? T.nagSpeech(med, nagCount - 1) : T.reminderSpeech(med, slot.id));
}

// ---------- יום שקט (שבת / חג) ----------
function quietDayTick(now, today) {
  const q = state.settings.quiet || {};
  const times = q.announceTimes || [];
  const max = q.maxAnnouncements || 2;
  const spoken = state.runtime.quietSpoken[today] || 0;
  if (spoken >= max) return;

  const nowHm = hm(now);
  const shouldHaveSpoken = times.filter(t => t <= nowHm).length;
  if (!shouldHaveSpoken) return;
  if (spoken >= Math.min(shouldHaveSpoken, max)) return;

  const pending = slotsForDate(today).filter(s => !s.status);
  if (!pending.length) return;          // אין מה להכריז — לא שורפים מכסת הודעות
  state.runtime.quietSpoken[today] = spoken + 1;
  save();

  const names = pending.map(s => s.med.name + ' ' + T.doseText(s.med)).join(', ');
  const msg = T.you() + ', יש לך היום ' + names + '.';
  chime('gentle');
  speak(msg, true);
  document.dispatchEvent(new CustomEvent('pill:quietannounce', { detail: { slots: pending, text: msg } }));
}

// ---------- הצטיידות ----------
function supplyTick(now) {
  const low = lowSupplyMeds();
  if (!low.length) return;
  const first = low[0];
  const body = low.map(x => x.med.name + ' — ' + (x.supply.daysLeft <= 0 ? 'נגמר' : x.supply.daysLeft + ' ימים')).join('\n');
  systemNotify({
    title: '📦 צריך לחדש תרופות',
    body: body,
    tag: 'refill',
    data: { kind: 'refill' }
  });
  document.dispatchEvent(new CustomEvent('pill:refill', { detail: { list: low } }));
  if (document.visibilityState === 'visible') {
    document.dispatchEvent(new CustomEvent('pill:toast', {
      detail: { text: T.refillText(first.med, first.supply.daysLeft), kind: 'warn', long: true }
    }));
  }
}

// ---------- פרוצדורות ----------
function procedureTick(now) {
  const list = alertingProcedures();
  if (!list.length) return;
  const body = list.map(p => p.title + ' — ' + procedureState(p).label).join('\n');
  systemNotify({
    title: '🩺 בדיקות ותורים',
    body: body,
    tag: 'procedures',
    data: { kind: 'procedure' }
  });
}

// ------------------------------------------------------------
//  נודניק
// ------------------------------------------------------------
export function snooze(sid, minutes) {
  const n = state.runtime.nag[sid] || { count: 1, lastAlertAt: Date.now(), snoozeUntil: 0 };
  n.snoozeUntil = Date.now() + minutes * 60000;
  state.runtime.nag[sid] = n;
  save();
  if (swReg) {
    swReg.getNotifications({ tag: 'dose-' + sid }).then(ns => ns.forEach(x => x.close())).catch(() => { });
  }
  chime('gentle');
}

export function clearNag(sid) {
  delete state.runtime.nag[sid];
  save();
  if (swReg) {
    swReg.getNotifications({ tag: 'dose-' + sid }).then(ns => ns.forEach(x => x.close())).catch(() => { });
  }
}

// ------------------------------------------------------------
//  שמירת מסך דלוק (למסך שבת / לוח לקיחות)
// ------------------------------------------------------------
export async function keepAwake(on) {
  try {
    if (on && 'wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
      return true;
    }
    if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch (e) { return false; }
  return false;
}

export function isAwakeHeld() { return !!wakeLock; }

// ------------------------------------------------------------
//  התראות מותנות — מופעל מ-sensors.js
// ------------------------------------------------------------
export function contextAlert(title, body, speech, tag) {
  chime('gentle');
  if (document.visibilityState === 'visible') {
    document.dispatchEvent(new CustomEvent('pill:toast', { detail: { text: body, kind: 'info', long: true } }));
  } else {
    systemNotify({ title: title, body: body, tag: tag || 'context', sticky: true, data: { kind: 'context' } });
  }
  if (speech) speak(speech);
}
