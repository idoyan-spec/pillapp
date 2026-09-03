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

  // כפתור מחיקה בכותרת — קודם הוא היה רק בתחתית טופס ארוך, ולא נמצא
  const del = isNew ? null : el('button', {
    class: 'sheet-close danger', html: '🗑', title: 'מחיקת התרופה', 'aria-label': 'מחיקת התרופה',
    onclick: async () => {
      const ok = await confirmBig('למחוק את ' + (m.name || 'התרופה') + ' ואת כל היסטוריית הלקיחות שלה?', 'כן, למחוק', true);
      if (ok) { S.deleteMed(m.id); closeSheet(); toast('נמחק', 'ok'); }
    }
  });

  openSheet(isNew ? 'תרופה חדשה' : m.name || 'עריכת תרופה', () => build(m, isNew, opts), null, del);
}

function build(m, isNew, opts) {
  opts = opts || {};
  const wrap = el('div');

  // ---------- שתי תמונות: אריזה + כדור ----------
  const photoGrid = el('div', { class: 'photo-grid' });
  wrap.appendChild(photoGrid);

  const aiStatus = el('div', { class: 'ai-status hidden' });
  wrap.appendChild(aiStatus);

  const SLOTS = [
    { key: 'photoBox', main: 'box', icon: '📦', label: 'אריזה', hint: 'הצד שכתוב עליו השם והמינון' },
    { key: 'photoPill', main: 'pill', icon: '💊', label: 'הכדור', hint: 'כדור אחד, מקרוב, על רקע בהיר' }
  ];

  function paintPhotos() {
    photoGrid.innerHTML = '';
    SLOTS.forEach(sl => {
      const has = !!m[sl.key];
      const cell = el('div', { class: 'photo-slot' + (has ? ' has' : '') });
      const frame = el('div', {
        class: 'photo-frame', onclick: () => pickPhoto(sl.key, 'camera')
      });
      if (has) frame.appendChild(el('img', { src: m[sl.key], alt: sl.label }));
      else frame.appendChild(el('span', { class: 'ph-icon', text: sl.icon }));
      cell.appendChild(frame);
      cell.appendChild(el('div', { class: 'photo-label', text: sl.icon + ' ' + sl.label }));

      if (has) {
        const row = el('div', { class: 'row', style: 'gap:6px;margin-top:6px' });
        row.appendChild(el('button', {
          class: 'chip' + (m.photoMain === sl.main ? ' on' : ''),
          style: 'flex:1;justify-content:center;min-height:40px;font-size:.8em',
          text: m.photoMain === sl.main ? '★ בתזכורת' : 'הצג בתזכורת',
          onclick: () => { m.photoMain = sl.main; paintPhotos(); }
        }));
        row.appendChild(el('button', {
          class: 'chip', style: 'min-height:40px;padding:0 12px',
          html: '🗑', title: 'מחיקה',
          onclick: () => { m[sl.key] = ''; paintPhotos(); }
        }));
        cell.appendChild(row);
      } else {
        cell.appendChild(el('div', { class: 'hint center', style: 'margin-top:4px', text: sl.hint }));
      }
      photoGrid.appendChild(cell);
    });

    const any = m.photoBox || m.photoPill;
    idBtn.classList.toggle('hidden', !any);
    idBtn.innerHTML = m.photoBox && m.photoPill
      ? '✨ זהה ומלא הכול (אריזה + כדור)'
      : m.photoBox ? '✨ זהה ומלא הכול מהאריזה' : '✨ נסה לזהות לפי הכדור';
  }

  const idBtn = el('button', { class: 'btn block hidden', style: 'margin-bottom:12px' });
  idBtn.addEventListener('click', runIdentify);
  wrap.appendChild(idBtn);

  function pickPhoto(key, source) {
    const input = document.querySelector('#filePicker');
    if (source === 'gallery') input.removeAttribute('capture');
    else input.setAttribute('capture', 'environment');
    input.value = '';
    input.onchange = async () => {
      const f = input.files && input.files[0];
      if (!f) return;
      try {
        m[key] = await Tools.fileToDataUrl(f, 1100);
        if (key === 'photoPill') m.photoMain = 'pill';
        paintPhotos();
        if (S.state.settings.geminiKey) runIdentify();
        else {
          aiStatus.classList.remove('hidden');
          aiStatus.className = 'ai-status info';
          aiStatus.innerHTML = 'התמונה נשמרה. כדי שהאפליקציה תמלא את הפרטים לבד — הוסיפי מפתח Gemini ב<b>הגדרות</b>.';
        }
      } catch (e) { toast(e.message, 'error'); }
    };
    input.click();
  }

  paintPhotos();
  if (opts.startWithCamera) setTimeout(() => pickPhoto('photoBox', 'camera'), 250);

  // ---------- הצינור: קריאה ויזואלית ← חיפוש מקורקע ← מילוי ----------
  let busy = false;

  async function runIdentify() {
    if (busy) return;
    if (!S.state.settings.geminiKey) { toast('צריך מפתח Gemini בהגדרות', 'warn', true); return; }
    busy = true;
    idBtn.disabled = true;
    aiStatus.classList.remove('hidden');
    aiStatus.className = 'ai-status';
    aiStatus.innerHTML = '<span class="busy"></span> קורא את התמונה…';

    try {
      const r = await G.identify(
        { box: m.photoBox, pill: m.photoPill },
        (stage, msg) => { aiStatus.innerHTML = '<span class="busy"></span> ' + esc(msg); }
      );
      applyIdentification(r.visual, r.info);
    } catch (e) {
      aiStatus.className = 'ai-status warn';
      aiStatus.innerHTML = '⚠️ ' + esc(e.message);
    }
    busy = false;
    idBtn.disabled = false;
  }

  /** מחליט מה למלא אוטומטית ומה דורש אישור מפורש */
  function applyIdentification(v, info) {
    // תיאור הכדור נשמר תמיד — הוא נקרא מהתמונה, לא מנוחש
    m.pill = {
      color: v.pillColor || m.pill.color || '',
      shape: v.pillShape || m.pill.shape || '',
      imprint: v.pillImprint || m.pill.imprint || '',
      scored: v.pillScored !== undefined ? !!v.pillScored : !!m.pill.scored
    };

    const fromBox = !!(v.name || v.nameEnglish || v.genericName);
    const trusted = fromBox || (info && info.identified === true && info.matchConfidence === 'high');

    if (trusted) {
      const n = fill(v, info);
      renderReview(v, info, n, false);
    } else {
      // זיהוי לפי כדור בלבד — לא ממלאים כלום בלי אישור מפורש
      renderReview(v, info, 0, true);
    }
  }

  /** ממלא את הטופס. האריזה קודמת לחיפוש; החיפוש משלים חורים בלבד. */
  function fill(v, info) {
    info = info || {};
    let n = 0;
    const setIf = (f, val) => {
      if (!val) return;
      if (String(fields[f].value || '').trim()) return;
      fields[f].value = val; n++;
    };

    setIf('name', v.name || info.brandName || info.genericName);
    setIf('genericName', v.genericName || info.genericName);
    setIf('strength', v.strength || info.strength);
    m.englishName = v.nameEnglish || info.englishName || m.englishName || '';

    const form = v.form || info.form;
    if (form && FORMS.indexOf(form) !== -1) { fields.form.value = form; n++; }

    const dose = v.doseText || info.typicalDose;
    if (dose) {
      const clean = String(dose).replace(/[^\d.,/]/g, '');
      if (clean && (!fields.doseText.value || fields.doseText.value === '1')) { fields.doseText.value = clean; n++; }
    }

    const cond = v.condition || info.typicalCondition;
    if (cond && CONDITIONS[cond] && fields.condition.value === 'none') { fields.condition.value = cond; n++; }
    setIf('conditionText', v.conditionText || info.typicalConditionText);

    const pack = v.packSize;
    if (pack && !fields.packSize.value) {
      fields.packSize.value = pack; n++;
      if (!fields.countOnHand.value) fields.countOnHand.value = pack;
    }

    // שעות — מהאריזה, ואם אין, לפי התדירות המקובלת
    let times = (v.suggestedTimes || []).filter(t => /^\d{1,2}:\d{2}$/.test(t));
    if (!times.length) times = (info.suggestedTimes || []).filter(t => /^\d{1,2}:\d{2}$/.test(t));
    if (!times.length && info.typicalTimesPerDay) {
      times = ({ 1: ['08:00'], 2: ['08:00', '20:00'], 3: ['08:00', '14:00', '20:00'], 4: ['08:00', '12:00', '16:00', '20:00'] })[info.typicalTimesPerDay] || [];
    }
    times = times.map(t => t.length === 4 ? '0' + t : t);
    if (times.length && m.schedule.times.length <= 1) {
      m.schedule.times = times; paintTimes(); n++;
    }

    // כרטיס המידע נשמר כבר עכשיו — כך שכפתור ℹ️ מלא מיד אחרי השמירה
    if (info.redWarnings || info.whatFor) {
      m.info = info;
      m.infoFetchedAt = Date.now();
      n++;
    }
    return n;
  }

  /** פאנל סקירה — מה זוהה, באיזו ודאות, ומה דורש אישור */
  function renderReview(v, info, filledCount, needsConfirm) {
    info = info || {};
    aiStatus.className = 'ai-status ' + (needsConfirm ? 'warn' : 'ok');
    aiStatus.innerHTML = '';

    const title = v.name || info.brandName || (info.identified ? info.genericName : '');

    if (needsConfirm) {
      aiStatus.appendChild(el('div', { class: 'ai-head', html: '⚠️ זיהוי לפי הכדור בלבד — לא ודאי' }));
      aiStatus.appendChild(el('p', {
        class: 'small',
        text: 'זיהוי תרופה לפי צורה, צבע וחריטה אינו אמין: כדורים שונים נראים דומים, ואותה חריטה יכולה להופיע על תרופות שונות. לכן לא מילאתי שום פרט לבד.'
      }));
    } else {
      aiStatus.appendChild(el('div', {
        class: 'ai-head',
        html: '✅ זוהה: <b>' + esc(title || 'התרופה') + '</b>' +
          (filledCount ? ' · מולאו ' + filledCount + ' פרטים' : '')
      }));
    }

    // מה נקרא מהתמונה
    const seen = [];
    if (v.regNumber) seen.push('מס׳ רישום ' + v.regNumber);
    if (v.manufacturer) seen.push(v.manufacturer);
    if (v.expiry) seen.push('תפוגה ' + v.expiry);
    const pd = [v.pillColor, v.pillShape, v.pillImprint].filter(Boolean).join(' · ');
    if (pd) seen.push('הכדור: ' + pd + (v.pillScored ? ' (קו חציה)' : ''));
    if (seen.length) {
      aiStatus.appendChild(el('div', { class: 'small muted', style: 'margin-top:6px', text: seen.join(' · ') }));
    }

    // אי-התאמה בין הכדור לאריזה — אזהרת בטיחות אמיתית
    if (info.mismatchWarning) {
      aiStatus.appendChild(el('div', { class: 'ai-mismatch', text: '⚠️ ' + info.mismatchWarning }));
    }

    if (needsConfirm) {
      const guess = info.brandName || info.genericName || '';
      // מציעים מילוי רק אם יש שם ואין אזהרת אי-התאמה — אי-התאמה היא בדיוק המקרה המסוכן
      const offerFill = !!guess && !info.mismatchWarning && info.matchConfidence !== 'low';

      if (guess) {
        aiStatus.appendChild(el('p', {
          class: 'small', style: 'margin-top:8px',
          html: 'ההשערה: <b>' + esc(guess) + '</b>' +
            (info.genericName && info.genericName !== guess ? ' (' + esc(info.genericName) + ')' : '') +
            (info.matchConfidence ? ' — ודאות ' + esc({ high: 'גבוהה', medium: 'בינונית', low: 'נמוכה' }[info.matchConfidence] || info.matchConfidence) : '')
        }));
      }
      if (offerFill) {
        aiStatus.appendChild(el('button', {
          class: 'btn due block', style: 'margin-top:10px',
          text: 'בדקתי מול הרוקח — מלא לפי ההשערה',
          onclick: e => {
            const n = fill(v, info);
            e.currentTarget.remove();
            toast('מולאו ' + n + ' פרטים. עברי על כל אחד מהם.', 'warn', true);
          }
        }));
      } else if (guess) {
        aiStatus.appendChild(el('p', {
          class: 'small', style: 'margin-top:6px;font-weight:700',
          text: 'לא אציע למלא לפי ההשערה הזאת — היא חלשה מדי או שיש בה סתירה.'
        }));
      }
      aiStatus.appendChild(el('p', {
        class: 'small', style: 'margin-top:10px',
        text: 'הדרך הבטוחה: לצלם גם את האריזה, או להקליד את השם ידנית. תמונת הכדור נשמרה ותוצג בתזכורת — וזה בפני עצמו מה שמונע בלבול בין כדורים.'
      }));
    } else {
      aiStatus.appendChild(el('p', { class: 'small', style: 'margin-top:8px', text: 'עברי על השדות ובדקי שהכול נכון לפני שמירה.' }));
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

  // הוספת שעה בפעולה אחת: בוחרים שעה והיא נכנסת מיד.
  // קודם היה צריך גם ללחוץ "הוספה" — צעד מיותר.
  const addTime = t => {
    if (!t || !/^\d{1,2}:\d{2}$/.test(t)) return;
    if (t.length === 4) t = '0' + t;
    if (m.schedule.times.indexOf(t) === -1) m.schedule.times.push(t);
    m.schedule.times.sort();
    paintTimes();
  };

  const timeInput = el('input', {
    type: 'time', style: 'max-width:170px',
    onchange: e => { addTime(e.currentTarget.value); e.currentTarget.value = ''; }
  });
  const addRow = el('div', { class: 'row', style: 'gap:8px;align-items:center' });
  addRow.appendChild(timeInput);
  addRow.appendChild(el('span', { class: 'hint', style: 'margin:0', text: 'נוספת מיד אחרי הבחירה' }));
  timesBox.appendChild(addRow);

  const presets = el('div', { class: 'chips', style: 'margin-top:10px' });
  TIME_PRESETS.forEach(p => {
    presets.appendChild(el('button', {
      class: 'chip', text: p.label + ' ' + p.t,
      onclick: () => addTime(p.t)
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
    if (info.mismatchWarning) {
      wrap.appendChild(el('div', { class: 'ai-mismatch', style: 'margin-bottom:14px', text: '⚠️ ' + info.mismatchWarning }));
    }
    if (info.identified === false) {
      wrap.appendChild(el('div', {
        class: 'ai-status warn', text: 'התרופה לא זוהתה בוודאות. המידע כאן הוא השערה בלבד — כדאי לאמת מול הרוקח.'
      }));
    }

    // אזהרות באדום — תמיד למעלה
    if (info.redWarnings && info.redWarnings.length) {
      const box = el('div', { class: 'info-warn' });
      box.appendChild(el('h3', { html: '⚠️ חשוב לדעת' }));
      const ul = el('ul');
      info.redWarnings.forEach(w => ul.appendChild(el('li', { text: w })));
      box.appendChild(ul);
      wrap.appendChild(box);
    }

    // תיאור הכדור — מה שנקרא מהתמונה
    const pd = S.pillDescription(med);
    if (pd) {
      const sec = el('div', { class: 'info-sec' });
      sec.appendChild(el('h3', { html: '💊 איך הכדור נראה' }));
      sec.appendChild(el('p', { text: pd + (med.pill.scored ? ' · עם קו חציה' : '') }));
      wrap.appendChild(sec);
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
