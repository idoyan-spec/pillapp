// ============================================================
//  text.js  —  פנייה אישית בעברית, מותאמת מגדר ושם
// ============================================================
import { state } from './store.js';
import { CONDITIONS } from './schedule.js';

/** בחירה לפי מגדר: g('תשכחי','תשכח') */
export function g(fem, masc) {
  return (state.settings.gender === 'm') ? masc : fem;
}

export function userName() {
  return (state.settings.userName || '').trim();
}

/** "יהודית, " או "" אם אין שם */
function vocative() {
  const n = userName();
  return n ? n + ', ' : '';
}

/** "יהודית" או "את"/"אתה" */
export function you() {
  return userName() || g('את', 'אתה');
}

export function greeting(now) {
  const h = (now || new Date()).getHours();
  const part = h < 5 ? 'לילה טוב' : h < 11 ? 'בוקר טוב' : h < 16 ? 'צהריים טובים' : h < 19 ? 'אחר צהריים טובים' : 'ערב טוב';
  const n = userName();
  return n ? part + ', ' + n : part;
}

function pick(arr, seed) {
  if (seed === undefined || seed === null) return arr[Math.floor(Math.random() * arr.length)];
  let h = 0;
  const s = String(seed);
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) & 0x7fffffff;
  return arr[h % arr.length];
}

/** תיאור המנה: "1 טבליה" / "2 כמוסות" */
export function doseText(med) {
  const amount = (med.doseText || '1').trim();
  const form = med.form || 'טבליה';
  const n = Number(amount);
  if (!isNaN(n) && n > 1) {
    const plural = { 'טבליה': 'טבליות', 'כמוסה': 'כמוסות', 'שקית': 'שקיות', 'זריקה': 'זריקות', 'מדבקה': 'מדבקות', 'טיפות': 'טיפות' };
    return amount + ' ' + (plural[form] || form);
  }
  if (form === 'טיפות') return amount + ' טיפות';
  return amount + ' ' + form;
}

export function conditionText(med) {
  const c = CONDITIONS[med.condition];
  const base = (c && c.short) ? c.short : '';
  const extra = (med.conditionText || '').trim();
  if (base && extra) return base + ' · ' + extra;
  return base || extra;
}

/** כותרת התזכורת הגדולה */
export function reminderTitle(med, seed) {
  return pick([
    vocative() + 'זה הזמן ל' + med.name,
    vocative() + g('קחי', 'קח') + ' עכשיו ' + med.name,
    vocative() + 'אל ' + g('תשכחי', 'תשכח') + ' את ' + med.name
  ], seed);
}

/** כותרת למנה שהזמן שלה חלף מזמן — לא אומרים "קחי עכשיו" על מנה ישנה */
export function lateReminderTitle(med, timeStr, agoStr) {
  return vocative() + 'המנה של ' + timeStr + ' לא סומנה — ' + agoStr;
}

/** משפט מלא לקריינות קולית */
export function reminderSpeech(med, seed) {
  const parts = [];
  parts.push(vocative() + 'זה הזמן לקחת ' + med.name);
  parts.push(doseText(med));
  const cond = conditionText(med);
  if (cond) parts.push(cond);
  return parts.join(', ') + '.';
}

/** נדנוד — הולך ומחמיר בנימוס */
export function nagSpeech(med, count) {
  const n = vocative();
  const lines = [
    n + 'עדיין לא סימנת שלקחת ' + med.name + '. ' + g('קחי', 'קח') + ' רגע ותסמני.',
    n + 'תזכורת שנייה: ' + med.name + ' מחכה לך.',
    n + 'אני לא ' + g('מרפה', 'מרפה') + '. ' + med.name + ' עדיין לא סומן.',
    n + 'בבקשה אל ' + g('תשכחי', 'תשכח') + ' את ' + med.name + '. זה חשוב.'
  ];
  return lines[Math.min(count, lines.length - 1)];
}

export function nagTitle(med, count) {
  const opts = ['עדיין לא סומן', 'תזכורת חוזרת', 'זה עדיין מחכה', 'חשוב — אל תדלגי'];
  if (state.settings.gender === 'm') opts[3] = 'חשוב — אל תדלג';
  return opts[Math.min(count, opts.length - 1)];
}

export function refillText(med, daysLeft) {
  if (daysLeft <= 0) return vocative() + 'נגמר ה' + med.name + '. צריך לחדש מרשם.';
  if (daysLeft === 1) return vocative() + 'נשאר יום אחד של ' + med.name + '. כדאי ' + g('להצטייד', 'להצטייד') + ' היום.';
  return vocative() + 'נשארו ' + daysLeft + ' ימים של ' + med.name + '. כדאי לחדש.';
}

export function leaveHomeText(meds) {
  const names = meds.map(m => m.name).join(' ו');
  return vocative() + g('יצאת', 'יצאת') + ' מהבית — ' + g('קחי', 'קח') + ' איתך את ' + names + '.';
}

export function wakeText(count) {
  return vocative() + greeting() + '. יש לך ' + count + ' ' + (count === 1 ? 'תרופה' : 'תרופות') + ' לבוקר.';
}

export function allDoneText() {
  return pick([
    vocative() + 'סיימת להיום. כל הכבוד.',
    vocative() + 'הכול מסומן. יום טוב.',
    vocative() + 'אין עוד תרופות היום.'
  ]);
}

export function procedureText(p) {
  const kinds = { blood_test: 'בדיקת דם', doctor: 'ביקור אצל הרופא', imaging: 'בדיקת הדמיה', other: '' };
  const kind = kinds[p.kind] || '';
  return vocative() + (kind ? kind + ' — ' : '') + p.title;
}
