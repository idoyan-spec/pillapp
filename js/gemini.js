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
//  1) זיהוי תרופה מצילום של אריזה / מרשם / דף הוראות
// ------------------------------------------------------------
const MED_SCHEMA = {
  type: 'object',
  properties: {
    name:         { type: 'string', description: 'שם התרופה כפי שמופיע, בעברית אם קיים' },
    nameEnglish:  { type: 'string' },
    genericName:  { type: 'string', description: 'החומר הפעיל' },
    strength:     { type: 'string', description: 'למשל 50 מ"ג' },
    form:         { type: 'string', description: 'טבליה / כמוסה / טיפות / סירופ / משאף / משחה / זריקה / מדבקה / שקית / אחר' },
    doseText:     { type: 'string', description: 'כמה יחידות בכל לקיחה, מספר בלבד אם ידוע' },
    timesPerDay:  { type: 'integer' },
    suggestedTimes: { type: 'array', items: { type: 'string' }, description: 'שעות בפורמט HH:MM' },
    condition:    { type: 'string', description: 'אחד מ: none, before_food, with_food, after_food, empty_stomach, with_water, bedtime, morning_fast' },
    conditionText:{ type: 'string' },
    packSize:     { type: 'integer', description: 'כמה יחידות באריזה' },
    notes:        { type: 'string' },
    confidence:   { type: 'string', description: 'high / medium / low' }
  },
  required: ['name']
};

export async function extractMedFromPhoto(dataUrl) {
  const m = dataUrl.match(/^data:(image\/[a-z+]+);base64,(.+)$/i);
  if (!m) throw new Error('התמונה לא נקראה כראוי.');
  const prompt = [
    'בתמונה יש אריזת תרופה, מרשם, או דף הוראות מבית מרקחת.',
    'חלץ את פרטי התרופה. אם פרט לא מופיע בתמונה — השאר אותו ריק, אל תמציא.',
    'שים לב במיוחד למינון (מ"ג), לצורת המתן, ולהוראות התדירות ("פעמיים ביום", "בבוקר ובערב", "לפני האוכל").',
    'אם ההוראות מציינות תדירות אבל לא שעות — הצע שעות סבירות ב-suggestedTimes.',
    'החזר JSON בלבד.'
  ].join(' ');

  const r = await call({
    contents: [{
      role: 'user',
      parts: [
        { inline_data: { mime_type: m[1], data: m[2] } },
        { text: prompt }
      ]
    }],
    generationConfig: {
      temperature: 0.1,
      responseMimeType: 'application/json',
      responseSchema: MED_SCHEMA
    }
  });
  return parseJson(r.text);
}

// ------------------------------------------------------------
//  2) כרטיס מידע מלא על התרופה (עם חיפוש מקורקע)
// ------------------------------------------------------------
export async function fetchDrugInfo(name, strength) {
  const q = name + (strength ? ' ' + strength : '');
  const prompt = [
    'חפש מידע עדכני על התרופה "' + q + '" (ישראל).',
    'התבסס על מאגר התרופות של משרד הבריאות, העלון לצרכן, ואתרי תרופות מהימנים.',
    'כתוב הכול בעברית פשוטה וברורה, לקורא לא-רפואי מבוגר.',
    'ב-redWarnings שים רק אזהרות שבאמת קריטיות — דברים שעלולים לגרום נזק אם לא יודעים אותם.',
    'ב-otherNames פרט שמות מסחריים מקבילים וגם את השם הגנרי.',
    'החזר JSON בלבד, ללא טקסט נוסף, לפי המבנה:',
    '{"brandName":"","englishName":"","genericName":"","otherNames":[],',
    '"whatFor":"","howItWorks":"","redWarnings":[],"howToTake":"",',
    '"missedDose":"","sideEffectsCommon":[],"sideEffectsSerious":[],',
    '"interactions":[],"foodDrink":"","storage":"","prescriptionOnly":true,',
    '"basketStatus":""}'
  ].join('\n');

  const r = await call({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    tools: [{ google_search: {} }],
    generationConfig: { temperature: 0.2 }
  });

  const info = parseJson(r.text);
  info.sources = r.sources;
  info.fetchedAt = Date.now();
  return info;
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
