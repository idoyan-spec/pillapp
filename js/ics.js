// ============================================================
//  ics.js  —  ייצוא התרופות ליומן של הטלפון
//  פתרון גיבוי אמין: היומן של הטלפון מצלצל גם כשהאפליקציה סגורה.
// ============================================================
import { state, ymd, parseYmd } from './store.js';
import { WEEKDAYS } from './schedule.js';
import { doseText, conditionText } from './text.js';

const BYDAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

function esc(s) {
  return String(s || '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

function stamp(d) {
  const p = n => String(n).padStart(2, '0');
  return d.getUTCFullYear() + p(d.getUTCMonth() + 1) + p(d.getUTCDate()) +
    'T' + p(d.getUTCHours()) + p(d.getUTCMinutes()) + p(d.getUTCSeconds()) + 'Z';
}

/** זמן צף (בלי אזור זמן) — הטלפון מפרש אותו כשעה מקומית, וזה בדיוק מה שרוצים */
function floating(dateStr, timeStr) {
  return dateStr.replace(/-/g, '') + 'T' + timeStr.replace(':', '') + '00';
}

function rrule(med) {
  const s = med.schedule || {};
  const until = s.endDate ? ';UNTIL=' + s.endDate.replace(/-/g, '') + 'T235900' : '';
  if (s.type === 'daily') return 'FREQ=DAILY' + until;
  if (s.type === 'weekdays') {
    const days = (s.weekdays || []).slice().sort().map(i => BYDAY[i]).join(',');
    return days ? 'FREQ=WEEKLY;BYDAY=' + days + until : null;
  }
  if (s.type === 'interval') {
    return 'FREQ=DAILY;INTERVAL=' + Math.max(1, Number(s.intervalDays) || 1) + until;
  }
  return null;
}

/** שורות ארוכות ב-ICS חייבות קיפול ל-75 בתים */
function fold(line) {
  if (line.length <= 73) return line;
  const out = [];
  let rest = line;
  out.push(rest.slice(0, 73));
  rest = rest.slice(73);
  while (rest.length) { out.push(' ' + rest.slice(0, 72)); rest = rest.slice(72); }
  return out.join('\r\n');
}

export function buildIcs() {
  const now = new Date();
  const dtstamp = stamp(now);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//pillApp//HE',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:' + esc('התרופות שלי')
  ];

  let count = 0;
  for (const med of state.meds) {
    if (!med.active) continue;
    const rule = rrule(med);
    if (!rule) continue;
    const start = med.schedule.startDate && med.schedule.startDate > ymd(now)
      ? med.schedule.startDate : ymd(now);

    for (const t of (med.schedule.times || [])) {
      const cond = conditionText(med);
      const title = med.name + ' — ' + doseText(med) + (med.strength ? ' (' + med.strength + ')' : '');
      const desc = [cond, med.notes].filter(Boolean).join(' · ') || 'תזכורת לקיחת תרופה';
      lines.push('BEGIN:VEVENT');
      lines.push('UID:' + med.id + '-' + t.replace(':', '') + '@pillapp');
      lines.push('DTSTAMP:' + dtstamp);
      lines.push('DTSTART:' + floating(start, t));
      lines.push('DURATION:PT10M');
      lines.push('RRULE:' + rule);
      lines.push(fold('SUMMARY:' + esc(title)));
      lines.push(fold('DESCRIPTION:' + esc(desc)));
      lines.push('BEGIN:VALARM');
      lines.push('TRIGGER:PT0M');
      lines.push('ACTION:DISPLAY');
      lines.push(fold('DESCRIPTION:' + esc(title)));
      lines.push('END:VALARM');
      lines.push('END:VEVENT');
      count++;
    }
  }

  lines.push('END:VCALENDAR');
  return { text: lines.join('\r\n'), count: count };
}

export function downloadIcs() {
  const r = buildIcs();
  if (!r.count) return 0;
  const blob = new Blob([r.text], { type: 'text/calendar;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'pillapp-' + ymd() + '.ics';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  return r.count;
}
