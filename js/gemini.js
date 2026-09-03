// ============================================================
//  gemini.js  —  זיהוי תרופה מצילום + כרטיס מידע מבוסס חיפוש
//  המפתח נשמר רק במכשיר (localStorage) ולעולם לא בקוד.
// ============================================================
import { state } from './store.js';

const BASE = 'https://generativelanguage.googleapis.com/v1beta/models/';

function key() {
  const k = (state.settings.geminiKey || '').trim();
  if (!k) {
    const e = new Error('חסר מפתח Gemini. פתחי הגדרות ← מפתח Gemini והדביקי אותו פעם אחת.');
    e.code = 'NO_KEY';
    throw e;
  }
  return k;
}

function model() {
  return state.settings.geminiModel || 'gemini-3.8-flash';
}

async function call(body, modelOverride) {
  const url = BASE + (modelOverride || model()) + ':generateContent?key=' + encodeURIComponent(key());
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    let msg = 'שגיאה ' + res.status;
    try {
      const j = await res.json();
      msg = (j.error && j.error.message) || msg;
      if (res.status === 400 && /API key/i.test(msg)) msg = 'המפתח לא תקין. בדקי אותו בהגדרות.';
      if (res.status === 429) msg = 'יותר מדי בקשות כרגע. נסי שוב בעוד דקה.';
    } catch (e) { /* ignore */ }
    throw new Error(msg);
  }
  const j = await res.json();
  const cand = j.candidates && j.candidates[0];
  const parts = (cand && cand.content && cand.content.parts) || [];
  const text = parts.map(p => p.text || '').join('');
  const sources = [];
  const chunks = (cand && cand.groundingMetadata && cand.groundingMetadata.groundingChunks) || [];
  for (const c of chunks) {
    if (c.web && c.web.uri) sources.push({ title: c.web.title || c.web.uri, uri: c.web.uri });
  }
  return { text: text, sources: sources };
}

function parseJson(text) {
  let t = (text || '').trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) t = fence[1].trim();
  const first = t.indexOf('{');
  const last = t.lastIndexOf('}');
  if (first >= 0 && last > first) t = t.slice(first, last + 1);
  return JSON.parse(t);
}

// ------------------------------------------------------------
//  1) שלב א׳: קריאה ויזואלית של מה שבאמת נראה בתמונות
//     (responseSchema, בלי חיפוש — כדי שלא ימציא מה שלא רואים)
// ------------------------------------------------------------
const VISUAL_SCHEMA = {
  type: 'object',
  properties: {
    name:         { type: 'string', description: 'שם התרופה כפי שמופיע על האריזה, בעברית אם קיים' },
    nameEnglish:  { type: 'string' },
    genericName:  { type: 'string', description: 'החומר הפעיל' },
    strength:     { type: 'string', description: 'למשל 50 מ"ג' },
    form:         { type: 'string', description: 'טבליה / כמוסה / טיפות / סירופ / משאף / משחה / זריקה / מדבקה / שקית / אחר' },
    doseText:     { type: 'string', description: 'כמה יחידות בכל לקיחה, מספר בלבד' },
    timesPerDay:  { type: 'integer' },
    suggestedTimes: { type: 'array', items: { type: 'string' }, description: 'שעות בפורמט HH:MM' },
    condition:    { type: 'string', description: 'אחד מ: none, before_food, with_food, after_food, empty_stomach, with_water, bedtime, morning_fast' },
    conditionText:{ type: 'string' },
    packSize:     { type: 'integer', description: 'כמה יחידות באריזה שלמה' },
    regNumber:    { type: 'string', description: 'מספר רישום משרד הבריאות, אם מופיע' },
    manufacturer: { type: 'string' },
    expiry:       { type: 'string', description: 'תאריך תפוגה אם מופיע' },
    pillColor:    { type: 'string', description: 'צבע הכדור עצמו' },
    pillShape:    { type: 'string', description: 'עגול / אליפסה / כמוסה / משולש / מרובע / אחר' },
    pillImprint:  { type: 'string', description: 'החריטה/ההטבעה על הכדור, בדיוק כפי שהיא' },
    pillScored:   { type: 'boolean', description: 'האם יש קו חציה' },
    sawBox:       { type: 'boolean', description: 'האם באמת נראתה אריזה או דף הוראות' },
    sawPill:      { type: 'boolean', description: 'האם באמת נראה כדור' },
    confidence:   { type: 'string', description: 'high / medium / low' }
  },
  required: ['confidence']
};

function imgPart(dataUrl) {
  const m = dataUrl.match(/^data:(image\/[a-z+]+);base64,(.+)$/i);
  if (!m) throw new Error('התמונה לא נקראה כראוי.');
  return { inline_data: { mime_type: m[1], data: m[2] } };
}

export async function extractFromPhotos(photos) {
  const parts = [];
  if (photos.box) { parts.push({ text: 'תמונה 1 — אריזה / מרשם / דף הוראות:' }); parts.push(imgPart(photos.box)); }
  if (photos.pill) { parts.push({ text: 'תמונה — הכדור עצמו:' }); parts.push(imgPart(photos.pill)); }
  if (!parts.length) throw new Error('אין תמונה לנתח.');

  parts.push({
    text: [
      'חלץ כל פרט שנראה בפועל בתמונות. אל תמציא — פרט שאינו נראה יישאר ריק.',
      'מהאריזה: שם, חומר פעיל, חוזק, צורה, גודל אריזה, מספר רישום, יצרן, ותאריך תפוגה.',
      'שים לב במיוחד להוראות מינון ותדירות ("פעמיים ביום", "בבוקר ובערב", "לפני האוכל").',
      'אם יש תדירות בלי שעות — הצע שעות סבירות ב-suggestedTimes בפורמט HH:MM.',
      'מהכדור: קרא בדיוק את החריטה/ההטבעה (pillImprint) כולל אותיות, ספרות וסימנים,',
      'וכן צבע, צורה, והאם יש קו חציה.',
      'סמן ב-sawBox / sawPill מה באמת נראה בתמונות.',
      'החזר JSON בלבד.'
    ].join('\n')
  });

  const r = await call({
    contents: [{ role: 'user', parts: parts }],
    generationConfig: {
      temperature: 0.1,
      responseMimeType: 'application/json',
      responseSchema: VISUAL_SCHEMA
    }
  });
  return parseJson(r.text);
}

// ------------------------------------------------------------
//  2) שלב ב׳: חיפוש מקורקע — משלים את כל מה שאין על האריזה
// ------------------------------------------------------------
const INFO_SHAPE =
  '{"identified":true,"matchConfidence":"high|medium|low","mismatchWarning":"",' +
  '"brandName":"","englishName":"","genericName":"","otherNames":[],' +
  '"strength":"","form":"","typicalDose":"","typicalTimesPerDay":1,' +
  '"typicalCondition":"none|before_food|with_food|after_food|empty_stomach|with_water|bedtime|morning_fast",' +
  '"typicalConditionText":"","suggestedTimes":[],' +
  '"whatFor":"","howItWorks":"","redWarnings":[],"howToTake":"","missedDose":"",' +
  '"sideEffectsCommon":[],"sideEffectsSerious":[],"interactions":[],' +
  '"foodDrink":"","storage":"","prescriptionOnly":true,"basketStatus":""}';

/**
 * @param {object} v  תוצאת extractFromPhotos, או {name, strength} לחיפוש ידני
 */
export async function lookupDrug(v) {
  const known = [];
  if (v.name) known.push('שם על האריזה: "' + v.name + '"');
  if (v.nameEnglish) known.push('שם באנגלית: "' + v.nameEnglish + '"');
  if (v.genericName) known.push('חומר פעיל: "' + v.genericName + '"');
  if (v.strength) known.push('חוזק: ' + v.strength);
  if (v.regNumber) known.push('מספר רישום משרד הבריאות: ' + v.regNumber);
  if (v.manufacturer) known.push('יצרן: ' + v.manufacturer);

  const pill = [];
  if (v.pillImprint) pill.push('חריטה "' + v.pillImprint + '"');
  if (v.pillColor) pill.push('צבע ' + v.pillColor);
  if (v.pillShape) pill.push('צורה ' + v.pillShape);
  if (v.pillScored) pill.push('עם קו חציה');

  const hasName = !!(v.name || v.nameEnglish || v.genericName);
  const lines = [];

  if (hasName) {
    lines.push('זהה ומצא מידע עדכני על התרופה הבאה (ישראל):');
    lines.push(known.join(', ') + '.');
    if (pill.length) {
      lines.push('נוסף לכך צולם הכדור עצמו: ' + pill.join(', ') + '.');
      lines.push('בדוק אם תיאור הכדור תואם לתרופה שעל האריזה. אם יש אי-התאמה ברורה —');
      lines.push('כתוב אותה ב-mismatchWarning בניסוח מובן, כי זה עלול להעיד על כדור שגוי באריזה.');
    }
    lines.push('identified=true אם זיהית את התרופה בוודאות.');
  } else {
    lines.push('נסה לזהות תרופה לפי תיאור הכדור בלבד: ' + pill.join(', ') + '.');
    lines.push('חפש במאגרי חריטות של כדורים (pill imprint identifier) ובמאגר משרד הבריאות.');
    lines.push('זהירות: זיהוי לפי חריטה בלבד אינו ודאי. אם אינך בטוח לחלוטין —');
    lines.push('החזר identified=false ו-matchConfidence="low", ואל תמציא שם תרופה.');
    lines.push('אם הצורה או הצבע אינם תואמים לתרופה שמצאת — כתוב זאת ב-mismatchWarning.');
  }

  lines.push('');
  lines.push('השלם את כל השדות שאתה יודע: שם גנרי, שמות מסחריים מקבילים, מינון מקובל,');
  lines.push('כמה פעמים ביום, תנאי לקיחה, ושעות סבירות ב-suggestedTimes (HH:MM).');
  lines.push('כתוב הכול בעברית פשוטה וברורה, לקורא לא-רפואי מבוגר.');
  lines.push('ב-redWarnings שים רק אזהרות שבאמת קריטיות — דברים שעלולים לגרום נזק אם לא יודעים אותם.');
  lines.push('החזר JSON בלבד, ללא טקסט נוסף, לפי המבנה:');
  lines.push(INFO_SHAPE);

  const r = await call({
    contents: [{ role: 'user', parts: [{ text: lines.join('\n') }] }],
    tools: [{ google_search: {} }],
    generationConfig: { temperature: 0.2 }
  });

  const info = parseJson(r.text);
  info.sources = r.sources;
  info.fetchedAt = Date.now();
  info.fromPillOnly = !hasName;
  return info;
}

/** כרטיס המידע של כפתור ה-ℹ️ */
export async function fetchDrugInfo(name, strength) {
  return lookupDrug({ name: name, strength: strength });
}

// ------------------------------------------------------------
//  2ב) איתור האזור הרלוונטי בתמונה, לחיתוך
// ------------------------------------------------------------
const BOX_SCHEMA = {
  type: 'object',
  properties: {
    found: { type: 'boolean' },
    box_2d: {
      type: 'array', items: { type: 'integer' },
      description: '[ymin, xmin, ymax, xmax] בקנה מידה 0-1000'
    }
  },
  required: ['found']
};

/**
 * מחזיר מלבן חיתוך יחסי (0..1) סביב האריזה או הכדור, או null.
 * @param {string} dataUrl
 * @param {'box'|'pill'} kind
 */
export async function findCropBox(dataUrl, kind) {
  const subject = kind === 'pill'
    ? 'הכדור / הטבליה / הכמוסה עצמה'
    : 'אריזת התרופה או דף ההוראות, כולל כל הטקסט שעליהם';
  const prompt = [
    'מצא את המלבן הקטן ביותר שמכיל את ' + subject + ', בלי הרקע מסביב.',
    'החזר box_2d כארבעה מספרים שלמים [ymin, xmin, ymax, xmax] בקנה מידה 0-1000',
    'יחסית לגובה ולרוחב התמונה. אם הנושא אינו בתמונה, found=false.'
  ].join(' ');

  const r = await call({
    contents: [{ role: 'user', parts: [imgPart(dataUrl), { text: prompt }] }],
    generationConfig: { temperature: 0, responseMimeType: 'application/json', responseSchema: BOX_SCHEMA }
  });
  const j = parseJson(r.text);
  if (!j.found || !Array.isArray(j.box_2d) || j.box_2d.length !== 4) return null;

  let [y0, x0, y1, x1] = j.box_2d.map(Number);
  if ([y0, x0, y1, x1].some(n => isNaN(n))) return null;
  if (y1 < y0) { const t = y0; y0 = y1; y1 = t; }
  if (x1 < x0) { const t = x0; x0 = x1; x1 = t; }
  const box = { x: x0 / 1000, y: y0 / 1000, w: (x1 - x0) / 1000, h: (y1 - y0) / 1000 };
  // מלבן קטן מדי או כמעט כל התמונה — אין טעם לחתוך
  if (box.w < 0.08 || box.h < 0.08) return null;
  if (box.w > 0.96 && box.h > 0.96) return null;
  return box;
}

// ------------------------------------------------------------
//  3) הצינור המלא: תמונות ← שדות + כרטיס מידע
// ------------------------------------------------------------
export async function identify(photos, onProgress) {
  onProgress = onProgress || function () { };
  onProgress('reading', 'קורא את התמונה…');
  const visual = await extractFromPhotos(photos);

  const hasAnything = visual.name || visual.nameEnglish || visual.genericName || visual.pillImprint;
  if (!hasAnything) return { visual: visual, info: null };

  onProgress('searching', visual.name
    ? 'מחפש מידע על ' + visual.name + '…'
    : 'מנסה לזהות לפי החריטה…');

  let info = null;
  try {
    info = await lookupDrug(visual);
  } catch (e) {
    console.warn('[pillApp] חיפוש המידע נכשל:', e.message);
  }
  return { visual: visual, info: info };
}

// ------------------------------------------------------------
//  3) בדיקת מפתח
// ------------------------------------------------------------
export async function testKey() {
  const r = await call({
    contents: [{ role: 'user', parts: [{ text: 'ענה במילה אחת: תקין' }] }],
    generationConfig: { temperature: 0 }
  });
  return r.text.trim();
}

// ------------------------------------------------------------
//  4) עזרה חופשית — לשאלה על תרופה
// ------------------------------------------------------------
export async function askAbout(medName, question) {
  const r = await call({
    contents: [{
      role: 'user',
      parts: [{
        text: 'שאלה על התרופה "' + medName + '": ' + question +
          '\nענה בעברית פשוטה, קצר וענייני. אם זו שאלה שמחייבת רופא — אמור זאת במפורש. השתמש בחיפוש כדי לוודא.'
      }]
    }],
    tools: [{ google_search: {} }],
    generationConfig: { temperature: 0.3 }
  });
  return r;
}
