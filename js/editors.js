// ============================================================
//  editors.js  —  עורך תרופה, כרטיס מידע, עורך פרוצדורה
// ============================================================
import * as S from './store.js';
import { CONDITIONS, FORMS, WEEKDAYS, scheduleText, supplyInfo } from './schedule.js';
import { el, esc, toast, openSheet, closeSheet, setSheetBody, confirmBig } from './dom.js';
import * as G from './gemini.js';
import * as Tools from './tools.js';
import * as T from './text.js';

const TIME_PRESETS = [
  { label: 'בוקר', t: '08:00' },
  { label: 'צהריים', t: '13:00' },
  { label: 'ערב', t: '19:00' },
  { label: 'לילה', t: '22:00' }
];

// ============================================================
//  עורך תרופה
// ============================================================
export function openMedEditor(med, opts) {
  opts = opts || {};
  const isNew = !med;
  const m = med ? JSON.parse(JSON.stringify(med)) : S.newMed();

  openSheet(isNew ? 'תרופה חדשה' : m.name || 'עריכת תרופה', () => build(m, isNew, opts));
}

function build(m, isNew, opts) {
  opts = opts || {};
  const wrap = el('div');

  // ---------- תמונה ----------
  const picBox = el('div', {
    class: 'reminder-pic',
    style: 'width:150px;height:150px;margin:0 auto 12px;font-size:3.4em;border-radius:22px'
  });
  function paintPic() {
    picBox.innerHTML = '';
    if (m.photo) picBox.appendChild(el('img', { src: m.photo, alt: '' }));
    else picBox.textContent = '💊';
  }
  paintPic();
  wrap.appendChild(picBox);

  const aiStatus = el('div', { class: 'hint center', style: 'margin-bottom:10px' });

  const picRow = el('div', { class: 'row', style: 'gap:8px;margin-bottom:6px' });
  picRow.appendChild(el('button', {
    class: 'btn ghost grow', html: '📷 צילום', onclick: () => pickPhoto('camera')
  }));
  picRow.appendChild(el('button', {
    class: 'btn ghost grow', html: '🖼️ מהגלריה', onclick: () => pickPhoto('gallery')
  }));
  if (m.photo) {
    picRow.appendChild(el('button', {
      class: 'btn ghost', html: '🗑', onclick: () => { m.photo = ''; paintPic(); }
    }));
  }
  wrap.appendChild(picRow);
  wrap.appendChild(aiStatus);

  function pickPhoto(source) {
    const input = document.querySelector('#filePicker');
    if (source === 'gallery') input.removeAttribute('capture');
    else input.setAttribute('capture', 'environment');
    input.value = '';
    input.onchange = async () => {
      const f = input.files && input.files[0];
      if (!f) return;
      try {
        m.photo = await Tools.fileToDataUrl(f, 900);
        paintPic();
        await tryIdentify();
      } catch (e) { toast(e.message, 'error'); }
    };
    input.click();
  }

  if (opts.startWithCamera) setTimeout(() => pickPhoto('camera'), 250);

  async function tryIdentify() {
    if (!S.state.settings.geminiKey) {
      aiStatus.innerHTML = 'התמונה נשמרה. כדי שהאפליקציה תזהה את התרופה לבד — הוסיפי מפתח Gemini בהגדרות.';
      return;
    }
    aiStatus.innerHTML = '<span class="busy"></span> קורא את התמונה…';
    try {
      const r = await G.extractMedFromPhoto(m.photo);
      let filled = 0;
      const setIf = (field, val) => {
        if (val && !String(fields[field].value || '').trim()) { fields[field].value = val; filled++; }
      };
      setIf('name', r.name);
      setIf('genericName', r.genericName);
      setIf('strength', r.strength);
      if (r.nameEnglish) m.englishName = r.nameEnglish;
      if (r.form && FORMS.indexOf(r.form) !== -1) fields.form.value = r.form;
      if (r.doseText) fields.doseText.value = String(r.doseText).replace(/[^\d.,/]/g, '') || fields.doseText.value;
      if (r.condition && CONDITIONS[r.condition]) fields.condition.value = r.condition;
      if (r.conditionText && !fields.conditionText.value) fields.conditionText.value = r.conditionText;
      if (r.packSize && !fields.packSize.value) {
        fields.packSize.value = r.packSize;
        if (!fields.countOnHand.value) fields.countOnHand.value = r.packSize;
      }
      if (r.suggestedTimes && r.suggestedTimes.length && m.schedule.times.length <= 1) {
        m.schedule.times = r.suggestedTimes.filter(t => /^\d{2}:\d{2}$/.test(t));
        if (!m.schedule.times.length) m.schedule.times = ['08:00'];
        paintTimes();
      }
      const conf = r.confidence === 'low' ? ' (זיהוי לא בטוח — כדאי לבדוק)' : '';
      aiStatus.innerHTML = filled
        ? '✅ זוהה: <b>' + esc(r.name || '') + '</b>' + esc(conf) + '. בדקי שהכול נכון.'
        : 'קראתי את התמונה אבל לא הצלחתי להוסיף פרטים חדשים.';
    } catch (e) {
      aiStatus.innerHTML = '⚠️ ' + esc(e.message);
    }
  }

  // ---------- שדות בסיס ----------
  const fields = {};
  function field(key, label, type, hint, attrs) {
    const input = el(type === 'textarea' ? 'textarea' : type === 'select' ? 'select' : 'input',
      Object.assign(type === 'textarea' || type === 'select' ? {} : { type: type || 'text' }, attrs || {}));
    fields[key] = input;
    const lab = el('label', { class: 'field' }, [
      el('span', { class: 'lbl', text: label }), input,
      hint ? el('div', { class: 'hint', text: hint }) : null
    ]);
    return lab;
  }

  wrap.appendChild(field('name', 'שם התרופה', 'text', null, { placeholder: 'למשל: אלטרוקסין' }));
  fields.name.value = m.name || '';

  const row2 = el('div', { class: 'row', style: 'gap:10px;align-items:flex-start' });
  const f1 = field('strength', 'חוזק', 'text', null, { placeholder: '50 מק״ג' });
  const f2 = field('form', 'צורה', 'select');
  FORMS.forEach(x => fields.form.appendChild(el('option', { value: x, text: x })));
  f1.classList.add('grow'); f2.classList.add('grow');
  row2.appendChild(f1); row2.appendChild(f2);
  wrap.appendChild(row2);
  fields.strength.value = m.strength || '';
  fields.form.value = m.form || 'טבליה';

  wrap.appendChild(field('doseText', 'כמה לוקחים בכל פעם', 'text', 'המספר שיוצג באותיות גדולות בתזכורת', { placeholder: '1', inputmode: 'decimal' }));
  fields.doseText.value = m.doseText || '1';

  wrap.appendChild(field('genericName', 'שם גנרי / חומר פעיל', 'text', null, { placeholder: 'לא חובה' }));
  fields.genericName.value = m.genericName || '';

  // ---------- תדירות ----------
  wrap.appendChild(el('h3', { text: 'מתי לוקחים', style: 'margin-top:22px' }));

  const typeChips = el('div', { class: 'chips', style: 'margin-bottom:14px' });
  const TYPES = [
    { v: 'daily', l: 'כל יום' },
    { v: 'weekdays', l: 'ימים מסוימים' },
    { v: 'interval', l: 'כל כמה ימים' },
    { v: 'asneeded', l: 'לפי הצורך' }
  ];
  TYPES.forEach(t => {
    typeChips.appendChild(el('button', {
      class: 'chip' + (m.schedule.type === t.v ? ' on' : ''), text: t.l, 'data-t': t.v,
      onclick: () => { m.schedule.type = t.v; refreshType(); }
    }));
  });
  wrap.appendChild(typeChips);

  const weekBox = el('div', { style: 'margin-bottom:14px' });
  const weekChips = el('div', { class: 'chips' });
  WEEKDAYS.forEach((name, i) => {
    weekChips.appendChild(el('button', {
      class: 'chip', text: name, 'data-d': i,
      onclick: e => {
        const arr = m.schedule.weekdays || [];
        const k = arr.indexOf(i);
        if (k === -1) arr.push(i); else arr.splice(k, 1);
        m.schedule.weekdays = arr;
        e.currentTarget.classList.toggle('on');
      }
    }));
  });
  weekBox.appendChild(el('div', { class: 'lbl', text: 'באילו ימים?', style: 'font-weight:700;margin-bottom:6px' }));
  weekBox.appendChild(weekChips);
  wrap.appendChild(weekBox);

  const intervalBox = field('intervalDays', 'כל כמה ימים?', 'number', null, { min: 1, max: 90, inputmode: 'numeric' });
  fields.intervalDays.value = m.schedule.intervalDays || 2;
  wrap.appendChild(intervalBox);

  // שעות
  const timesBox = el('div', { style: 'margin-bottom:14px' });
  timesBox.appendChild(el('div', { class: 'lbl', text: 'באילו שעות?', style: 'font-weight:700;margin-bottom:8px' }));
  const timePills = el('div', { class: 'timepills', style: 'margin-bottom:10px' });
  timesBox.appendChild(timePills);

  const addRow = el('div', { class: 'row', style: 'gap:8px' });
  const timeInput = el('input', { type: 'time', style: 'max-width:150px' });
  addRow.appendChild(timeInput);
  addRow.appendChild(el('button', {
    class: 'btn ghost', text: '＋ הוספה',
    onclick: () => {
      if (!timeInput.value) return;
      if (m.schedule.times.indexOf(timeInput.value) === -1) m.schedule.times.push(timeInput.value);
      m.schedule.times.sort();
      paintTimes();
    }
  }));
  timesBox.appendChild(addRow);

  const presets = el('div', { class: 'chips', style: 'margin-top:10px' });
  TIME_PRESETS.forEach(p => {
    presets.appendChild(el('button', {
      class: 'chip', text: p.label + ' ' + p.t,
      onclick: () => {
        if (m.schedule.times.indexOf(p.t) === -1) m.schedule.times.push(p.t);
        m.schedule.times.sort(); paintTimes();
      }
    }));
  });
  timesBox.appendChild(presets);
  wrap.appendChild(timesBox);

  function paintTimes() {
    timePills.innerHTML = '';
    if (!m.schedule.times.length) {
      timePills.appendChild(el('span', { class: 'muted', text: 'עדיין לא נבחרו שעות' }));
    }
    m.schedule.times.forEach(t => {
      timePills.appendChild(el('span', { class: 'timepill' }, [
        document.createTextNode(t),
        el('button', {
          text: '✕', title: 'הסרה',
          onclick: () => { m.schedule.times = m.schedule.times.filter(x => x !== t); paintTimes(); }
        })
      ]));
    });
  }
  paintTimes();

  // תאריכי התחלה וסיום
  const dateRow = el('div', { class: 'row', style: 'gap:10px;align-items:flex-start' });
  const d1 = field('startDate', 'מתאריך', 'date');
  const d2 = field('endDate', 'עד תאריך (לא חובה)', 'date');
  d1.classList.add('grow'); d2.classList.add('grow');
  dateRow.appendChild(d1); dateRow.appendChild(d2);
  wrap.appendChild(dateRow);
  fields.startDate.value = m.schedule.startDate || S.ymd();
  fields.endDate.value = m.schedule.endDate || '';

  function refreshType() {
    Array.prototype.forEach.call(typeChips.children, c => {
      c.classList.toggle('on', c.getAttribute('data-t') === m.schedule.type);
    });
    weekBox.classList.toggle('hidden', m.schedule.type !== 'weekdays');
    intervalBox.classList.toggle('hidden', m.schedule.type !== 'interval');
    timesBox.classList.toggle('hidden', m.schedule.type === 'asneeded');
    Array.prototype.forEach.call(weekChips.children, c => {
      c.classList.toggle('on', (m.schedule.weekdays || []).indexOf(Number(c.getAttribute('data-d'))) !== -1);
    });
  }
  refreshType();

  // ---------- תנאים ----------
  wrap.appendChild(el('h3', { text: 'תנאים והוראות', style: 'margin-top:22px' }));
  const condField = field('condition', 'תנאי לקיחה', 'select');
  Object.keys(CONDITIONS).forEach(k => {
    fields.condition.appendChild(el('option', { value: k, text: CONDITIONS[k].label }));
  });
  fields.condition.value = m.condition || 'none';
  wrap.appendChild(condField);
  wrap.appendChild(field('conditionText', 'הוראה נוספת', 'text', 'תופיע בתזכורת מתחת לשם', { placeholder: 'למשל: לא עם חלב' }));
  fields.conditionText.value = m.conditionText || '';

  // ---------- מלאי ----------
  wrap.appendChild(el('h3', { text: 'מלאי והצטיידות', style: 'margin-top:22px' }));
  const supRow = el('div', { class: 'row', style: 'gap:10px;align-items:flex-start' });
  const s1 = field('countOnHand', 'כמה יש עכשיו', 'number', null, { min: 0, inputmode: 'numeric', placeholder: 'לא עוקב' });
  const s2 = field('unitsPerDose', 'יחידות בכל לקיחה', 'number', null, { min: 0.25, step: 0.25, inputmode: 'decimal' });
  s1.classList.add('grow'); s2.classList.add('grow');
  supRow.appendChild(s1); supRow.appendChild(s2);
  wrap.appendChild(supRow);
  fields.countOnHand.value = (typeof m.supply.countOnHand === 'number') ? m.supply.countOnHand : '';
  fields.unitsPerDose.value = m.supply.unitsPerDose || 1;
  wrap.appendChild(field('packSize', 'כמה באריזה שלמה', 'number', 'משמש לכפתור "חידשתי מלאי"', { min: 1, inputmode: 'numeric', placeholder: 'לא חובה' }));
  fields.packSize.value = m.supply.packSize || '';

  // ---------- הערות ----------
  wrap.appendChild(field('notes', 'הערות אישיות', 'textarea', null, { placeholder: 'כל מה שחשוב לזכור על התרופה הזאת' }));
  fields.notes.value = m.notes || '';

  // ---------- פעיל ----------
  const activeLab = el('label', { class: 'checkline' });
  const activeCb = el('input', { type: 'checkbox' });
  activeCb.checked = m.active !== false;
  activeLab.appendChild(activeCb);
  activeLab.appendChild(el('span', { text: 'התרופה פעילה (מופיעה בלוח היומי)' }));
  wrap.appendChild(activeLab);

  // ---------- שמירה ----------
  wrap.appendChild(el('div', { class: 'spacer' }));
  wrap.appendChild(el('button', {
    class: 'btn block big', text: '✓ שמירה',
    onclick: () => {
      m.name = fields.name.value.trim();
      if (!m.name) { toast('צריך שם לתרופה', 'error'); fields.name.focus(); return; }
      m.strength = fields.strength.value.trim();
      m.form = fields.form.value;
      m.doseText = fields.doseText.value.trim() || '1';
      m.genericName = fields.genericName.value.trim();
      m.schedule.intervalDays = Math.max(1, Number(fields.intervalDays.value) || 1);
      m.schedule.startDate = fields.startDate.value || S.ymd();
      m.schedule.endDate = fields.endDate.value || '';
      if (m.schedule.type !== 'asneeded' && !m.schedule.times.length) {
        toast('צריך לבחור לפחות שעה אחת', 'error'); return;
      }
      if (m.schedule.type === 'weekdays' && !(m.schedule.weekdays || []).length) {
        toast('צריך לבחור לפחות יום אחד', 'error'); return;
      }
      m.condition = fields.condition.value;
      m.conditionText = fields.conditionText.value.trim();
      const cnt = fields.countOnHand.value;
      m.supply.countOnHand = cnt === '' ? null : Math.max(0, Number(cnt));
      m.supply.unitsPerDose = Number(fields.unitsPerDose.value) || 1;
      const ps = fields.packSize.value;
      m.supply.packSize = ps === '' ? null : Number(ps);
      m.notes = fields.notes.value;
      m.active = activeCb.checked;

      S.upsertMed(m);
      closeSheet();
      toast('נשמר: ' + m.name, 'ok');
    }
  }));

  if (!isNew) {
    wrap.appendChild(el('div', { class: 'spacer' }));
    wrap.appendChild(el('button', {
      class: 'btn ghost block', text: '🗑 מחיקת התרופה',
      onclick: async () => {
        const ok = await confirmBig('למחוק את ' + m.name + ' ואת כל היסטוריית הלקיחות שלה?', 'כן, למחוק', true);
        if (ok) { S.deleteMed(m.id); closeSheet(); toast('נמחק', 'ok'); }
      }
    }));
  }

  return wrap;
}

// ============================================================
//  כרטיס מידע על התרופה
// ============================================================
export function openDrugInfo(med) {
  openSheet('מידע על ' + med.name, () => renderInfo(med));
}

function renderInfo(med) {
  const wrap = el('div');
  const info = med.info;

  if (!info) {
    wrap.appendChild(el('div', { class: 'empty' }, [
      el('div', { class: 'big', text: '📖' }),
      el('p', { text: 'עוד אין כרטיס מידע לתרופה הזאת.' }),
      el('p', { class: 'small', text: 'האפליקציה תחפש בעלון לצרכן ובמאגרי התרופות ותסדר את המידע כאן.' })
    ]));
  } else {
    // אזהרות באדום — תמיד למעלה
    if (info.redWarnings && info.redWarnings.length) {
      const box = el('div', { class: 'info-warn' });
      box.appendChild(el('h3', { html: '⚠️ חשוב לדעת' }));
      const ul = el('ul');
      info.redWarnings.forEach(w => ul.appendChild(el('li', { text: w })));
      box.appendChild(ul);
      wrap.appendChild(box);
    }

    // שמות
    const names = [];
    if (info.genericName) names.push(info.genericName);
    if (info.englishName) names.push(info.englishName);
    (info.otherNames || []).forEach(n => { if (names.indexOf(n) === -1) names.push(n); });
    if (names.length) {
      const sec = el('div', { class: 'info-sec' });
      sec.appendChild(el('h3', { html: '🏷️ שמות נוספים וגנריים' }));
      const box = el('div', { class: 'names' });
      names.forEach(n => box.appendChild(el('span', { class: 'name-pill', text: n })));
      sec.appendChild(box);
      wrap.appendChild(sec);
    }

    const sec = (icon, title, content) => {
      if (!content || (Array.isArray(content) && !content.length)) return;
      const s = el('div', { class: 'info-sec' });
      s.appendChild(el('h3', { html: icon + ' ' + esc(title) }));
      if (Array.isArray(content)) {
        const ul = el('ul');
        content.forEach(x => ul.appendChild(el('li', { text: x })));
        s.appendChild(ul);
      } else {
        s.appendChild(el('p', { text: content }));
      }
      wrap.appendChild(s);
    };

    sec('💡', 'למה התרופה הזאת', info.whatFor);
    sec('⚙️', 'איך היא פועלת', info.howItWorks);
    sec('🥄', 'איך לוקחים', info.howToTake);
    sec('🍽️', 'אוכל ושתייה', info.foodDrink);
    sec('❓', 'אם שכחת מנה', info.missedDose);
    sec('😐', 'תופעות לוואי שכיחות', info.sideEffectsCommon);
    sec('🚨', 'תופעות לוואי שמחייבות רופא', info.sideEffectsSerious);
    sec('🔀', 'תרופות שלא מסתדרות איתה', info.interactions);
    sec('📦', 'אחסון', info.storage);
    if (info.basketStatus) sec('🏥', 'סל הבריאות', info.basketStatus);

    if (info.sources && info.sources.length) {
      const s = el('div', { class: 'info-sec sources' });
      s.appendChild(el('h3', { html: '🔗 מקורות' }));
      info.sources.slice(0, 8).forEach(src => {
        s.appendChild(el('a', { href: src.uri, target: '_blank', rel: 'noopener', text: src.title || src.uri }));
      });
      wrap.appendChild(s);
    }

    if (info.fetchedAt) {
      wrap.appendChild(el('p', {
        class: 'hint',
        text: 'המידע נאסף ב־' + new Date(info.fetchedAt).toLocaleDateString('he-IL') +
          '. הוא אינו תחליף לייעוץ רפואי — במקרה של ספק, שאלי את הרופא או הרוקח.'
      }));
    }
  }

  wrap.appendChild(el('div', { class: 'spacer' }));
  const btn = el('button', {
    class: 'btn block' + (info ? ' ghost' : ''),
    html: info ? '🔄 עדכון המידע' : '✨ חיפוש המידע עכשיו'
  });
  btn.addEventListener('click', async () => {
    if (!S.state.settings.geminiKey) {
      toast('צריך מפתח Gemini בהגדרות כדי לשלוף מידע', 'warn', true);
      return;
    }
    btn.disabled = true;
    btn.innerHTML = '<span class="busy"></span> מחפש בעלון ובמאגרים…';
    try {
      const q = [med.name, med.englishName, med.genericName].filter(Boolean).join(' ');
      const res = await G.fetchDrugInfo(q, med.strength);
      med.info = res;
      med.infoFetchedAt = Date.now();
      S.upsertMed(med);
      setSheetBody(renderInfo(med));
      toast('המידע עודכן', 'ok');
    } catch (e) {
      btn.disabled = false;
      btn.innerHTML = info ? '🔄 עדכון המידע' : '✨ חיפוש המידע עכשיו';
      toast(e.message, 'error', true);
    }
  });
  wrap.appendChild(btn);

  // שאלה חופשית
  wrap.appendChild(el('div', { class: 'spacer' }));
  const qBox = el('div');
  const qInput = el('input', { type: 'text', placeholder: 'שאלה על התרופה…' });
  const qAns = el('div', { class: 'card flat hidden', style: 'margin-top:10px;white-space:pre-wrap' });
  const qBtn = el('button', { class: 'btn ghost block', text: 'שאלי', style: 'margin-top:8px' });
  qBtn.addEventListener('click', async () => {
    const q = qInput.value.trim();
    if (!q) return;
    if (!S.state.settings.geminiKey) { toast('צריך מפתח Gemini בהגדרות', 'warn'); return; }
    qAns.classList.remove('hidden');
    qAns.innerHTML = '<span class="busy"></span> בודק…';
    try {
      const r = await G.askAbout(med.name, q);
      qAns.textContent = r.text;
    } catch (e) { qAns.textContent = '⚠️ ' + e.message; }
  });
  qBox.appendChild(el('label', { class: 'field' }, [
    el('span', { class: 'lbl', text: 'רוצה לשאול משהו על התרופה?' }), qInput
  ]));
  qBox.appendChild(qBtn);
  qBox.appendChild(qAns);
  wrap.appendChild(qBox);

  return wrap;
}

// ============================================================
//  עורך פרוצדורה (בדיקות, תורים)
// ============================================================
const PROC_KINDS = [
  { v: 'blood_test', l: '🩸 בדיקת דם' },
  { v: 'doctor', l: '🩺 ביקור רופא' },
  { v: 'imaging', l: '🖥️ בדיקת הדמיה' },
  { v: 'other', l: '📌 אחר' }
];

export function openProcedureEditor(proc) {
  const isNew = !proc;
  const p = proc ? JSON.parse(JSON.stringify(proc)) : S.newProcedure();

  openSheet(isNew ? 'בדיקה או תור חדש' : 'עריכה', () => {
    const wrap = el('div');
    const f = {};

    const kindChips = el('div', { class: 'chips', style: 'margin-bottom:16px' });
    PROC_KINDS.forEach(k => {
      kindChips.appendChild(el('button', {
        class: 'chip' + (p.kind === k.v ? ' on' : ''), text: k.l,
        onclick: e => {
          p.kind = k.v;
          Array.prototype.forEach.call(kindChips.children, c => c.classList.remove('on'));
          e.currentTarget.classList.add('on');
        }
      }));
    });
    wrap.appendChild(kindChips);

    const mk = (key, label, type, attrs, hint) => {
      const input = el(type === 'textarea' ? 'textarea' : type === 'select' ? 'select' : 'input',
        Object.assign(type === 'textarea' || type === 'select' ? {} : { type: type }, attrs || {}));
      f[key] = input;
      wrap.appendChild(el('label', { class: 'field' }, [
        el('span', { class: 'lbl', text: label }), input, hint ? el('div', { class: 'hint', text: hint }) : null
      ]));
    };

    mk('title', 'מה צריך לעשות', 'text', { placeholder: 'למשל: ספירת דם ותפקודי תריס' });
    f.title.value = p.title;
    mk('dueDate', 'מתי', 'date');
    f.dueDate.value = p.dueDate;
    mk('remindDaysBefore', 'להתחיל להזכיר כמה ימים קודם', 'number', { min: 0, max: 90, inputmode: 'numeric' });
    f.remindDaysBefore.value = p.remindDaysBefore;
    mk('repeatMonths', 'לחזור כל כמה חודשים', 'number', { min: 0, max: 36, inputmode: 'numeric' }, '0 = בדיקה חד־פעמית');
    f.repeatMonths.value = p.repeatMonths;

    mk('linkedMedId', 'קשור לתרופה', 'select');
    f.linkedMedId.appendChild(el('option', { value: '', text: '— ללא —' }));
    S.state.meds.forEach(m => f.linkedMedId.appendChild(el('option', { value: m.id, text: m.name })));
    f.linkedMedId.value = p.linkedMedId || '';

    mk('notes', 'הערות', 'textarea', { placeholder: 'הפניה, מיקום, הכנות…' });
    f.notes.value = p.notes;

    wrap.appendChild(el('button', {
      class: 'btn block big', text: '✓ שמירה',
      onclick: () => {
        p.title = f.title.value.trim();
        if (!p.title) { toast('צריך לכתוב מה צריך לעשות', 'error'); return; }
        p.dueDate = f.dueDate.value || S.ymd();
        p.remindDaysBefore = Number(f.remindDaysBefore.value) || 0;
        p.repeatMonths = Number(f.repeatMonths.value) || 0;
        p.linkedMedId = f.linkedMedId.value;
        p.notes = f.notes.value;
        S.upsertProcedure(p);
        closeSheet();
        toast('נשמר', 'ok');
      }
    }));

    if (!isNew) {
      wrap.appendChild(el('div', { class: 'spacer' }));
      wrap.appendChild(el('button', {
        class: 'btn ok block', text: '✓ בוצע',
        onclick: () => {
          if (p.repeatMonths > 0) {
            const d = S.parseYmd(p.dueDate);
            d.setMonth(d.getMonth() + p.repeatMonths);
            p.dueDate = S.ymd(d);
            S.upsertProcedure(p);
            toast('נקבע מועד הבא: ' + p.dueDate, 'ok');
          } else {
            p.done = true;
            S.upsertProcedure(p);
            toast('סומן כבוצע', 'ok');
          }
          closeSheet();
        }
      }));
      wrap.appendChild(el('div', { class: 'spacer' }));
      wrap.appendChild(el('button', {
        class: 'btn ghost block', text: '🗑 מחיקה',
        onclick: async () => {
          const ok = await confirmBig('למחוק את "' + p.title + '"?', 'למחוק', true);
          if (ok) { S.deleteProcedure(p.id); closeSheet(); }
        }
      }));
    }
    return wrap;
  });
}
