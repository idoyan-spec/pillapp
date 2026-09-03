// ============================================================
//  text.js  —  פנייה אישית בעברית, מותאמת מגדר, שם וסגנון
//  ברירת המחדל היא לבבית ואמפתית. תרופות זה לא כיף, והאפליקציה
//  לא צריכה להישמע כמו מכונה שמצווה עלייך.
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

function vocative() {
  const n = userName();
  return n ? n + ', ' : '';
}

export function you() {
  return userName() || g('את', 'אתה');
}

export const TONES = {
  warm: { label: '💛 לבבי וחם', hint: 'רך, אמפתי, כמו מישהו שאכפת לו. ברירת המחדל.' },
  gentle: { label: '🕊️ שקט ועדין', hint: 'מעט מילים, בלי התלהבות, בלי לחץ.' },
  cheerful: { label: '☀️ קליל ומחייך', hint: 'אופטימי, עם קריצה.' },
  plain: { label: '📋 ענייני וקצר', hint: 'רק העובדות, בלי קישוטים.' }
};

export function tone() {
  return TONES[state.settings.tone] ? state.settings.tone : 'warm';
}

function pick(arr, seed) {
  if (!arr || !arr.length) return '';
  if (seed === undefined || seed === null) return arr[Math.floor(Math.random() * arr.length)];
  let h = 0;
  const s = String(seed);
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) & 0x7fffffff;
  return arr[h % arr.length];
}

/** בוחר וריאציה לפי הסגנון, עם נפילה אחורה ל"לבבי" */
function byTone(bank, seed) {
  const t = tone();
  return pick(bank[t] || bank.warm, seed);
}

// ------------------------------------------------------------
//  ברכות
// ------------------------------------------------------------
export function greeting(now) {
  const h = (now || new Date()).getHours();
  const part = h < 5 ? 'לילה טוב' : h < 11 ? 'בוקר טוב' : h < 16 ? 'צהריים טובים'
    : h < 19 ? 'אחר צהריים טובים' : 'ערב טוב';
  const n = userName();
  if (!n) return part;
  const t = tone();
  if (t === 'plain') return part;
  if (t === 'cheerful') return part + ', ' + n + ' ☀️';
  return part + ', ' + n;
}

// ------------------------------------------------------------
//  תיאורי מנה
// ------------------------------------------------------------
export function doseText(med) {
  const amount = (med.doseText || '1').trim();
  const form = med.form || 'טבליה';
  const n = Number(amount);
  if (!isNaN(n) && n > 1) {
    const plural = {
      'טבליה': 'טבליות', 'כמוסה': 'כמוסות', 'שקית': 'שקיות',
      'זריקה': 'זריקות', 'מדבקה': 'מדבקות', 'טיפות': 'טיפות'
    };
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

// ------------------------------------------------------------
//  התזכורת עצמה
// ------------------------------------------------------------
export function reminderTitle(med, seed) {
  const n = vocative();
  const take = g('קחי', 'קח');
  return byTone({
    warm: [
      n + 'זה הזמן ל' + med.name + ' 💛',
      n + take + ' רגע את ה' + med.name + ', ואני כאן',
      n + 'תזכורת קטנה ובאהבה: ' + med.name
    ],
    gentle: [
      n + 'הגיע הזמן ל' + med.name,
      n + med.name + ', כשנוח לך'
    ],
    cheerful: [
      n + 'רגע קטן ל' + med.name + ' ואפשר להמשיך ☀️',
      n + 'עוד אחת קטנה — ' + med.name + '!'
    ],
    plain: [med.name + ' — ' + doseText(med)]
  }, seed);
}

/** כותרת למנה שהזמן שלה חלף — בלי להאשים, בלי "קחי עכשיו" */
export function lateReminderTitle(med, timeStr, agoStr) {
  const n = vocative();
  return byTone({
    warm: [n + 'המנה של ' + timeStr + ' עוד לא סומנה — קורה, בואי נסדר את זה'],
    gentle: [n + 'המנה של ' + timeStr + ' לא סומנה (' + agoStr + ')'],
    cheerful: [n + 'המנה של ' + timeStr + ' חמקה לנו — נסמן?'],
    plain: [med.name + ' · ' + timeStr + ' — לא סומן, ' + agoStr]
  });
}

export function reminderSpeech(med, seed) {
  const parts = [];
  const n = vocative();
  const take = g('קחי', 'קח');
  parts.push(byTone({
    warm: [n + 'זה הזמן ל' + med.name],
    gentle: [n + med.name],
    cheerful: [n + 'רגע ל' + med.name],
    plain: [med.name]
  }, seed));
  parts.push(doseText(med));
  const cond = conditionText(med);
  if (cond) parts.push(cond);
  let out = parts.join(', ') + '.';
  if (tone() === 'warm') out += ' ' + g('שתהיי', 'שתהיה') + ' בריאה.';
  return out;
}

// ------------------------------------------------------------
//  נדנוד — עקשן, אף פעם לא נוזף
// ------------------------------------------------------------
export function nagTitle(med, count) {
  const banks = {
    warm: ['עוד לא סומן — הכול בסדר', 'אני עדיין כאן', 'רק מזכירה באהבה', 'זה חשוב לי בשבילך'],
    gentle: ['עדיין לא סומן', 'תזכורת נוספת', 'עדיין מחכה', 'תזכורת אחרונה'],
    cheerful: ['עוד לא סימנו!', 'אני לא שוכחת ☀️', 'עדיין כאן ומחייכת', 'נו, רק לחיצה אחת'],
    plain: ['לא סומן', 'תזכורת 2', 'תזכורת 3', 'תזכורת 4']
  };
  const b = banks[tone()] || banks.warm;
  return b[Math.min(count, b.length - 1)];
}

export function nagSpeech(med, count) {
  const n = vocative();
  const take = g('קחי', 'קח');
  const banks = {
    warm: [
      n + 'עוד לא סימנת את ' + med.name + '. אין לחץ, רק מזכירה.',
      n + 'אני עדיין כאן עם ' + med.name + '. ' + take + ' כשנוח לך.',
      n + 'לא מוותרת עלייך. ' + med.name + ' מחכה.',
      n + 'זה באמת חשוב לבריאות שלך. ' + med.name + '.'
    ],
    gentle: [
      n + med.name + ' עדיין לא סומן.',
      n + 'תזכורת שנייה: ' + med.name + '.',
      n + med.name + ' ממתין.',
      n + 'בבקשה אל ' + g('תשכחי', 'תשכח') + ' את ' + med.name + '.'
    ],
    cheerful: [
      n + 'עוד לא סימנו את ' + med.name + '!',
      n + 'אני עקשנית בקטע טוב. ' + med.name + '.',
      n + 'רק לחיצה אחת ואני שותקת.',
      n + med.name + ' מחכה ומחייך.'
    ],
    plain: [
      med.name + ' לא סומן.',
      med.name + ' — תזכורת שנייה.',
      med.name + ' — תזכורת שלישית.',
      med.name + ' — עדיין לא סומן.'
    ]
  };
  const b = banks[tone()] || banks.warm;
  return b[Math.min(count, b.length - 1)];
}

// ------------------------------------------------------------
//  מצבים אחרים
// ------------------------------------------------------------
export function refillText(med, daysLeft) {
  const n = vocative();
  if (daysLeft <= 0) {
    return byTone({
      warm: [n + 'ה' + med.name + ' נגמר. בואי נדאג לחידוש כדי שלא תישארי בלי.'],
      gentle: [n + 'ה' + med.name + ' נגמר. צריך לחדש מרשם.'],
      cheerful: [n + 'ה' + med.name + ' אזל! זמן לחידוש.'],
      plain: [med.name + ' — נגמר.']
    });
  }
  if (daysLeft === 1) {
    return byTone({
      warm: [n + 'נשאר יום אחד של ' + med.name + '. שווה לסדר את זה היום, בלי לחץ.'],
      gentle: [n + 'נשאר יום אחד של ' + med.name + '.'],
      cheerful: [n + 'יום אחרון של ' + med.name + ' — נחדש?'],
      plain: [med.name + ' — נשאר יום אחד.']
    });
  }
  return byTone({
    warm: [n + 'נשארו ' + daysLeft + ' ימים של ' + med.name + '. יש זמן, רק שלא נשכח.'],
    gentle: [n + 'נשארו ' + daysLeft + ' ימים של ' + med.name + '.'],
    cheerful: [n + 'עוד ' + daysLeft + ' ימים של ' + med.name + ' — כדאי לחדש.'],
    plain: [med.name + ' — ' + daysLeft + ' ימים.']
  });
}

export function leaveHomeText(meds) {
  const names = meds.map(m => m.name).join(' ו');
  const n = vocative();
  const take = g('קחי', 'קח');
  return byTone({
    warm: [n + take + ' איתך את ' + names + '. שיהיה לך יום טוב 💛'],
    gentle: [n + take + ' איתך את ' + names + '.'],
    cheerful: [n + 'לא לשכוח את ' + names + ' בדרך! ☀️'],
    plain: ['לקחת: ' + names]
  });
}

export function wakeText(count) {
  const n = vocative();
  const word = count === 1 ? 'תרופה' : 'תרופות';
  return byTone({
    warm: [n + greeting() + '. יש לך ' + count + ' ' + word + ' לבוקר, כשתהיי מוכנה.'],
    gentle: [n + greeting() + '. ' + count + ' ' + word + ' לבוקר.'],
    cheerful: [n + greeting() + '! ' + count + ' ' + word + ' ויוצאים לדרך ☀️'],
    plain: [count + ' ' + word + ' לבוקר.']
  });
}

export function allDoneText() {
  const n = vocative();
  return byTone({
    warm: [
      n + 'סיימת להיום. שמרת על עצמך יפה 💛',
      n + 'הכול מסומן. אני גאה בך.',
      n + 'זהו להיום. תהיי בריאה.'
    ],
    gentle: [n + 'הכול מסומן להיום.', n + 'אין עוד תרופות היום.'],
    cheerful: [n + 'סיימנו! יום מצוין ☀️', n + 'הכול בוצע. אלופה!'],
    plain: ['הכול סומן.']
  });
}

export function procedureText(p) {
  const kinds = { blood_test: 'בדיקת דם', doctor: 'ביקור אצל הרופא', imaging: 'בדיקת הדמיה', other: '' };
  const kind = kinds[p.kind] || '';
  return vocative() + (kind ? kind + ' — ' : '') + p.title;
}

/** מילת עידוד קצרה אחרי סימון — מוצגת כטוסט */
export function praise() {
  return byTone({
    warm: ['יפה מאוד 💛', 'תודה שסימנת', 'כל הכבוד לך', 'עשית את זה'],
    gentle: ['סומן', 'נרשם', 'תודה'],
    cheerful: ['אלופה! ☀️', 'מצוין!', 'ככה זה נראה!'],
    plain: ['סומן']
  });
}
