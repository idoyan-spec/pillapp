// ============================================================
//  tools/gen-terms.mjs  —  גוזר את TERMS.md מתוך js/legal.js
//  js/legal.js הוא מקור האמת היחיד לנוסח. אל תערוך את TERMS.md ידנית.
//  הרצה:  node tools/gen-terms.mjs
//  זהו כלי פיתוח בלבד — האפליקציה עצמה נשארת סטטית ובלי שלב בנייה.
// ============================================================
import { writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// legal.js מייבא את store.js, שנוגע ב-localStorage. מספיק לנו הייצוא הסטטי,
// ולכן טוענים אותו עם דמה מינימלי במקום להריץ דפדפן.
globalThis.localStorage = { getItem: () => null, setItem: () => { } };
globalThis.document = { dispatchEvent: () => { } };

const legal = await import(pathToFileURL(join(root, 'js', 'legal.js')).href);

// המרה מ-HTML קל (כפי שהתקנון נכתב עבור הממשק) ל-Markdown.
// בלי ביטויים רגולריים בכוונה — הטקסט עברי וארוך, ו-split/join קריא יותר.
const NL = String.fromCharCode(10);
function toMarkdown(t) {
  let out = t
    .split('<b>').join('**').split('</b>').join('**')
    .split('<ul>').join(NL).split('</ul>').join('')
    .split('<li>').join(NL + '- ').split('</li>').join('');
  while (out.indexOf(NL + NL + NL) !== -1) {
    out = out.split(NL + NL + NL).join(NL + NL);
  }
  return out.trim();
}

const lines = [];
lines.push('# תנאי שימוש — ' + legal.APP_NAME);
lines.push('');
lines.push('**גרסה ' + legal.TERMS_VERSION + ' · ' + legal.TERMS_DATE + '**');
lines.push('');
lines.push('> היישום הוא **עזר לזיכרון בלבד**. הוא אינו מכשיר רפואי, אינו תחליף לרופא,');
lines.push('> לרוקח או לעלון, ואין להסתמך עליו.');
lines.push('');
lines.push('המסמך מוצג באפליקציה בכניסה הראשונה, ואישורו הוא תנאי לשימוש.');
lines.push('המקור המחייב הוא `js/legal.js`; קובץ זה נגזר ממנו אוטומטית');
lines.push('בפקודה `node tools/gen-terms.mjs`.');
lines.push('');
lines.push('---');
lines.push('');

for (const sec of legal.SECTIONS) {
  lines.push('## ' + toMarkdown(sec.t));
  lines.push('');
  for (const para of sec.p) {
    lines.push(toMarkdown(para));
    lines.push('');
  }
}

writeFileSync(join(root, 'TERMS.md'), lines.join('\n'), 'utf8');
console.log('TERMS.md נכתב — גרסה ' + legal.TERMS_VERSION + ', ' + legal.SECTIONS.length + ' סעיפים.');
