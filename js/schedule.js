// ============================================================
//  schedule.js  —  חישוב מנות, ימים שקטים, מלאי, היענות
// ============================================================
import { state, ymd, hm, atTime, parseYmd, addDays, daysBetween, slotId } from './store.js';

export const CONDITIONS = {
  none:         { label: 'ללא תנאי',            short: '',                icon: '' },
  before_food:  { label: 'לפני האוכל',          short: 'לפני אוכל',       icon: '🍽️' },
  with_food:    { label: 'עם האוכל',            short: 'עם אוכל',         icon: '🍽️' },
  after_food:   { label: 'אחרי האוכל',          short: 'אחרי אוכל',       icon: '🍽️' },
  empty_stomach:{ label: 'על קיבה ריקה',        short: 'קיבה ריקה',       icon: '⛔' },
  with_water:   { label: 'עם כוס מים מלאה',     short: 'עם מים',          icon: '💧' },
  bedtime:      { label: 'לפני השינה',          short: 'לפני השינה',      icon: '🌙' },
  morning_fast: { label: 'בבוקר בצום, שעה לפני ארוחה', short: 'בוקר בצום', icon: '⏰' }
};

export const FORMS = ['טבליה', 'כמוסה', 'טיפות', 'סירופ', 'זריקה', 'משאף', 'משחה', 'מדבקה', 'שקית', 'אחר'];

export const WEEKDAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
export const WEEKDAYS_SHORT = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש'];

// ---------- האם התרופה נלקחת בתאריך מסוים ----------
export function occursOn(med, dateStr) {
  if (!med.active) return false;
  const s = med.schedule || {};
  if (s.type === 'asneeded') return false;

  const d = parseYmd(dateStr);
  if (s.startDate && dateStr < s.startDate) return false;
  if (s.endDate && dateStr > s.endDate) return false;

  if (s.type === 'daily') return true;
  if (s.type === 'weekdays') return (s.weekdays || []).indexOf(d.getDay()) !== -1;
  if (s.type === 'interval') {
    const n = Math.max(1, Number(s.intervalDays) || 1);
    const start = parseYmd(s.startDate || dateStr);
    const diff = daysBetween(start, d);
    return diff >= 0 && diff % n === 0;
  }
  return true;
}

// ---------- כל המנות של יום ----------
export function slotsForDate(dateStr) {
  const out = [];
  for (const med of state.meds) {
    if (!occursOn(med, dateStr)) continue;
    const times = (med.schedule.times || []).slice().sort();
    for (const t of times) {
      // מנות שהזמן שלהן חלף עוד לפני שהתרופה הוזנה אינן קיימות —
      // אחרת אפליקציה חדשה מתחילה עם עשרות "החמצות" מדומות.
      if (med.createdAt && atTime(dateStr, t).getTime() < med.createdAt - 60000) continue;
      const id = slotId(med.id, dateStr, t);
      out.push({
        id: id,
        medId: med.id,
        med: med,
        time: t,
        dateStr: dateStr,
        at: atTime(dateStr, t),
        log: state.log[id] || null,
        status: (state.log[id] && state.log[id].status) || null
      });
    }
  }
  out.sort((a, b) => a.time.localeCompare(b.time) || a.med.name.localeCompare(b.med.name, 'he'));
  return out;
}

/** מנות שעברו את זמנן ולא סומנו — מהיום ומאתמול (עד nagMaxHours אחורה) */
export function overdueSlots(now) {
  now = now || new Date();
  const maxMs = (state.settings.nagMaxHours || 5) * 3600000;
  const res = [];
  for (const off of [-1, 0]) {
    const ds = ymd(addDays(now, off));
    for (const s of slotsForDate(ds)) {
      if (s.status) continue;
      const late = now - s.at;
      if (late > 0 && late <= maxMs) res.push(Object.assign({ lateMs: late }, s));
    }
  }
  res.sort((a, b) => b.lateMs - a.lateMs);
  return res;
}

/**
 * כל המנות שהזמן שלהן חלף ולא סומנו — בלי תקרת זמן.
 * זה מה שמוצג כשפותחים את האפליקציה: "לא ירפה" חייב להיות בלי חלון זמן,
 * אחרת מנה שהוחמצה בבוקר פשוט נעלמת בצהריים.
 */
export function unmarkedSlots(now, daysBack) {
  now = now || new Date();
  const back = daysBack === undefined ? 2 : daysBack;
  const res = [];
  for (let off = -back; off <= 0; off++) {
    const ds = ymd(addDays(now, off));
    for (const s of slotsForDate(ds)) {
      if (s.status) continue;
      if (now - s.at > 0) res.push(Object.assign({ lateMs: now - s.at }, s));
    }
  }
  res.sort((a, b) => b.lateMs - a.lateMs);
  return res;
}

/** מנות שכבר יצאו מחלון הנדנוד אבל עדיין לא סומנו */
export function missedSlots(now) {
  now = now || new Date();
  const maxMs = (state.settings.nagMaxHours || 5) * 3600000;
  return unmarkedSlots(now).filter(s => s.lateMs > maxMs);
}

/** ניסוח "לפני כמה זמן" */
export function agoText(ms) {
  const min = Math.round(ms / 60000);
  if (min < 1) return 'ממש עכשיו';
  if (min === 1) return 'לפני דקה';
  if (min === 2) return 'לפני שתי דקות';
  if (min < 60) return 'לפני ' + min + ' דקות';
  const h = Math.round(min / 60);
  if (h < 24) return 'לפני ' + (h === 1 ? 'שעה' : h === 2 ? 'שעתיים' : h + ' שעות');
  const d = Math.round(h / 24);
  return 'לפני ' + (d === 1 ? 'יום' : d === 2 ? 'יומיים' : d + ' ימים');
}

export function nextSlot(now) {
  now = now || new Date();
  for (let off = 0; off <= 3; off++) {
    const ds = ymd(addDays(now, off));
    const list = slotsForDate(ds).filter(s => !s.status && s.at > now);
    if (list.length) return list[0];
  }
  return null;
}

// ---------- ימים שקטים ----------
export function isQuietDate(dateStr) {
  const st = state.settings;
  if ((st.quietDates || []).indexOf(dateStr) !== -1) return true;
  const d = parseYmd(dateStr);
  return (st.quietWeekdays || []).indexOf(d.getDay()) !== -1;
}
export function isQuietNow(now) {
  return isQuietDate(ymd(now || new Date()));
}

// ---------- מלאי והצטיידות ----------
export function dosesPerDay(med) {
  const s = med.schedule || {};
  const perDose = Number(med.supply.unitsPerDose) || 1;
  const timesCount = (s.times || []).length;
  if (s.type === 'asneeded') return 0;
  if (s.type === 'daily') return timesCount * perDose;
  if (s.type === 'weekdays') return timesCount * perDose * ((s.weekdays || []).length / 7);
  if (s.type === 'interval') return timesCount * perDose / Math.max(1, Number(s.intervalDays) || 1);
  return timesCount * perDose;
}

export function supplyInfo(med) {
  const count = med.supply.countOnHand;
  if (typeof count !== 'number' || isNaN(count)) return { tracked: false };
  const perDay = dosesPerDay(med);
  const daysLeft = perDay > 0 ? Math.floor(count / perDay) : Infinity;
  const warn = state.settings.refillWarnDays || 7;
  return {
    tracked: true,
    count: count,
    perDay: perDay,
    daysLeft: daysLeft,
    low: daysLeft <= warn,
    critical: daysLeft <= Math.ceil(warn / 3),
    outDate: isFinite(daysLeft) ? ymd(addDays(new Date(), daysLeft)) : null
  };
}

export function lowSupplyMeds() {
  return state.meds
    .filter(m => m.active)
    .map(m => ({ med: m, supply: supplyInfo(m) }))
    .filter(x => x.supply.tracked && x.supply.low)
    .sort((a, b) => a.supply.daysLeft - b.supply.daysLeft);
}

// ---------- פרוצדורות ----------
export function procedureState(p) {
  const today = ymd();
  const due = parseYmd(p.dueDate);
  const days = daysBetween(new Date(), due);
  return {
    days: days,
    overdue: !p.done && days < 0,
    soon: !p.done && days >= 0 && days <= (p.remindDaysBefore || 7),
    dueToday: days === 0,
    label: days === 0 ? 'היום' : days > 0 ? ('בעוד ' + days + ' ימים') : ('באיחור של ' + (-days) + ' ימים')
  };
}
export function activeProcedures() {
  return state.procedures
    .filter(p => !p.done)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}
export function alertingProcedures() {
  return activeProcedures().filter(p => { const s = procedureState(p); return s.overdue || s.soon; });
}

// ---------- היענות ----------
export function adherence(days) {
  days = days || 7;
  let total = 0, taken = 0;
  const now = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const ds = ymd(addDays(now, -i));
    for (const s of slotsForDate(ds)) {
      if (s.at > now) continue;
      total++;
      if (s.status === 'taken') taken++;
    }
  }
  return { total: total, taken: taken, pct: total ? Math.round(taken * 100 / total) : 100 };
}

// ---------- תיאור תדירות בעברית ----------
export function scheduleText(med) {
  const s = med.schedule || {};
  const times = (s.times || []).join(', ');
  if (s.type === 'asneeded') return 'לפי הצורך';
  if (s.type === 'daily') return 'כל יום ב־' + times;
  if (s.type === 'weekdays') {
    const names = (s.weekdays || []).slice().sort().map(i => WEEKDAYS_SHORT[i]).join(', ');
    return 'בימים ' + names + ' ב־' + times;
  }
  if (s.type === 'interval') {
    const n = Number(s.intervalDays) || 1;
    return (n === 1 ? 'כל יום' : n === 2 ? 'כל יומיים' : 'כל ' + n + ' ימים') + ' ב־' + times;
  }
  return times;
}
