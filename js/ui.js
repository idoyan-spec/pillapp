// ============================================================
//  ui.js  —  מסכים, התזכורת הגדולה, זכוכית מגדלת, מסך שבת
// ============================================================
import * as S from './store.js';
import * as Sch from './schedule.js';
import * as T from './text.js';
import * as N from './notify.js';
import * as Tools from './tools.js';
import * as Sensors from './sensors.js';
import * as G from './gemini.js';
import * as ICS from './ics.js';
import * as Push from './push.js';
import * as Install from './install.js';
import * as Perms from './perms.js';
import * as Nav from './nav.js';
import * as Legal from './legal.js';
import { $, el, esc, toast, openSheet, closeSheet, confirmBig, promptBig } from './dom.js';
import { openMedEditor, openDrugInfo, openProcedureEditor } from './editors.js';

let _view = 'today';
let permsSummary = null;
export const currentView = () => _view;
let currentReminder = null;

// ============================================================
//  שלד
// ============================================================
export function showView(name) {
  _view = name;
  ['today', 'meds', 'track', 'notes', 'settings'].forEach(v => {
    $('#view-' + v).classList.toggle('hidden', v !== name);
  });
  Array.prototype.forEach.call($('#tabbar').children, b => {
    b.classList.toggle('on', b.getAttribute('data-view') === name);
  });
  render();
  window.scrollTo(0, 0);
}

/** מרענן את מצב האישורים ברקע. מרנדר מחדש רק אם באמת השתנה, כדי לא ללולאה. */
function refreshPerms() {
  Perms.snapshot().then(list => {
    const sum = Perms.summarize(list);
    const changed = !permsSummary ||
      permsSummary.granted !== sum.granted || permsSummary.total !== sum.total ||
      permsSummary.missingRequired !== sum.missingRequired;
    permsSummary = sum;
    if (changed && _view === 'settings') renderSettings();
  }).catch(() => { });
}

export function render() {
  applyLook();
  refreshPerms();
  $('#hello').textContent = T.greeting();
  $('#buildStamp').innerHTML = 'גרסה <span dir="ltr">' + esc(S.BUILD) + '</span>';
  if (_view === 'today') renderToday();
  if (_view === 'meds') renderMeds();
  if (_view === 'track') renderTrack();
  if (_view === 'notes') renderNotes();
  if (_view === 'settings') renderSettings();
  paintTabBadge();
  if (currentReminder) refreshReminderIfMarked();
}

export function activePalette() {
  const p = S.state.settings.palette;
  if (p === 'f' || p === 'm') return p;
  return S.state.settings.gender === 'm' ? 'm' : 'f';   // ברירת מחדל לפי הפנייה
}

function applyLook() {
  const root = document.documentElement;
  root.style.setProperty('--fs', S.state.settings.fontScale || 1);
  const th = S.state.settings.theme;
  if (th === 'auto') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', th);

  root.setAttribute('data-palette', activePalette());

  // צבע סרגל המערכת בטלפון — שיתאים לערכה
  const bg = getComputedStyle(root).getPropertyValue('--paper').trim();
  document.querySelectorAll('meta[name="theme-color"]').forEach(mt => {
    if (bg) mt.setAttribute('content', bg);
  });
}

function paintTabBadge() {
  const bar = $('#tabbar');
  const btn = bar.children[0];
  const old = btn.querySelector('.dot');
  if (old) old.remove();
  const n = Sch.unmarkedSlots().length;
  if (n > 0) btn.appendChild(el('span', { class: 'dot', text: String(n) }));
}

// ============================================================
//  מסך "היום"
// ============================================================
function renderToday() {
  const v = $('#view-today');
  v.innerHTML = '';
  const now = new Date();
  const today = S.ymd(now);
  const quiet = Sch.isQuietDate(today);
  const slots = Sch.slotsForDate(today);

  // כותרת
  const head = el('div', { style: 'margin-bottom:16px' });
  head.appendChild(el('h1', { text: T.greeting(now) }));
  head.appendChild(el('div', {
    class: 'muted',
    text: now.toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long' })
  }));
  v.appendChild(head);

  if (quiet) {
    const b = el('div', { class: 'card', style: 'border-color:var(--quiet);background:var(--quiet-bg)' });
    b.appendChild(el('div', { class: 'card-title', html: '<span class="ico">🕯️</span> יום שקט — בלי נודניק' }));
    b.appendChild(el('p', {
      class: 'small',
      text: 'היום האפליקציה לא תנדנד. יהיו עד ' + (S.state.settings.quiet.maxAnnouncements || 2) +
        ' הודעות קוליות בשעות ' + (S.state.settings.quiet.announceTimes || []).join(' ו־') + '.'
    }));
    b.appendChild(el('button', { class: 'btn block', html: '🕯️ פתיחת מסך שבת', onclick: openShabbat }));
    v.appendChild(b);
  }

  // התזכורות לא יגיעו כשהאפליקציה סגורה — הדבר הכי חשוב שאפשר לתקן, ולכן כאן ולא בהגדרות
  if (S.state.meds.length && (!S.state.settings.push.enabled || N.permission() !== 'granted')) {
    const b = el('div', { class: 'card', style: 'border-color:var(--danger);background:var(--danger-bg)' });
    b.appendChild(el('div', { class: 'card-title', html: '<span class="ico">🔕</span> התזכורות לא יגיעו' }));
    b.appendChild(el('p', {
      class: 'small',
      text: 'כרגע תזכורת תופיע רק אם האפליקציה פתוחה. הפעלה חד־פעמית תגרום לתזכורת להגיע ' +
        'עם התמונה גם כשהטלפון נעול, ולחזור עד שמסמנים.'
    }));
    b.appendChild(el('button', {
      class: 'btn block big', html: '▶ הפעלת התזכורות',
      onclick: async e => {
        const btn = e.currentTarget;
        // אין הרשאת התראות -> מסך האישורים מטפל בהכול ומפעיל בסוף לבד
        if (N.permission() !== 'granted') { openPermissions(true); return; }
        btn.disabled = true; btn.innerHTML = '<span class="busy"></span> מפעיל…';
        try {
          const r = await Push.enable(S.state.settings.push.server);
          try { await Push.testPush(); } catch (e2) { /* לא קריטי */ }
          toast('הופעל! נרשמו ' + r.slots + ' תזכורות. שלחתי התראת בדיקה — היא אמורה להופיע עכשיו.', 'ok', true);
        } catch (err) { toast(err.message, 'error', true); }
        render();
      }
    }));
    v.appendChild(b);
  }

  // מנות שלא סומנו — כולל כאלה שכבר יצאו מחלון הנדנוד. בראש המסך, תמיד.
  const stale = Sch.unmarkedSlots(now).filter(s => s.lateMs > (S.state.settings.nagMaxHours || 5) * 3600000);
  if (stale.length) {
    const c = el('div', { class: 'card', style: 'border-color:var(--danger);background:var(--danger-bg)' });
    c.appendChild(el('div', {
      class: 'card-title',
      html: '<span class="ico">⚠️</span> ' + (stale.length === 1 ? 'מנה שלא סומנה' : stale.length + ' מנות שלא סומנו')
    }));
    stale.slice(0, 6).forEach(s => {
      const row = el('div', { class: 'row', style: 'margin-bottom:10px;flex-wrap:wrap' });
      row.appendChild(el('div', { class: 'grow', style: 'min-width:140px' }, [
        el('div', { html: '<b>' + esc(s.med.name) + '</b> · ' + esc(T.doseText(s.med)) }),
        el('div', { class: 'small muted', text: s.time + ' · ' + Sch.agoText(s.lateMs) })
      ]));
      row.appendChild(el('button', {
        class: 'btn ok', text: '✓ לקחתי',
        onclick: () => { S.markSlot(s.id, 'taken'); N.clearNag(s.id); N.chime('success'); }
      }));
      row.appendChild(el('button', {
        class: 'btn ghost', text: 'דילגתי',
        onclick: () => { S.markSlot(s.id, 'skipped'); N.clearNag(s.id); }
      }));
      c.appendChild(row);
    });
    if (stale.length > 6) c.appendChild(el('div', { class: 'small muted', text: 'ועוד ' + (stale.length - 6) + '…' }));
    v.appendChild(c);
  }

  // התראות
  const alerts = el('div');
  const low = Sch.lowSupplyMeds();
  if (low.length) {
    const c = el('div', { class: 'card', style: 'border-color:var(--due);background:var(--due-bg)' });
    c.appendChild(el('div', { class: 'card-title', html: '<span class="ico">📦</span> צריך להצטייד' }));
    low.forEach(x => {
      const row = el('div', { class: 'row', style: 'margin-bottom:8px' });
      row.appendChild(el('div', {
        class: 'grow',
        html: '<b>' + esc(x.med.name) + '</b> — ' +
          (x.supply.daysLeft <= 0 ? 'נגמר' : 'מספיק ל־' + x.supply.daysLeft + ' ימים') +
          ' (' + x.supply.count + ' יחידות)'
      }));
      row.appendChild(el('button', {
        class: 'btn ghost', text: 'חידשתי',
        onclick: () => refillMed(x.med)
      }));
      c.appendChild(row);
    });
    alerts.appendChild(c);
  }

  const procs = Sch.alertingProcedures();
  if (procs.length) {
    const c = el('div', { class: 'card', style: 'border-color:var(--info);background:var(--info-bg)' });
    c.appendChild(el('div', { class: 'card-title', html: '<span class="ico">🩺</span> בדיקות ותורים' }));
    procs.forEach(p => {
      const st = Sch.procedureState(p);
      c.appendChild(el('div', {
        class: 'row', style: 'margin-bottom:8px;cursor:pointer',
        onclick: () => openProcedureEditor(p)
      }, [
        el('div', { class: 'grow', html: '<b>' + esc(p.title) + '</b>' }),
        el('span', { class: 'badge ' + (st.overdue ? 'danger' : 'due'), text: st.label })
      ]));
    });
    alerts.appendChild(c);
  }
  if (alerts.children.length) v.appendChild(alerts);

  if (!S.state.meds.length) {
    v.appendChild(el('div', { class: 'empty' }, [
      el('div', { class: 'big', text: '💊' }),
      el('h2', { text: 'עוד לא הוספת תרופות' }),
      el('p', { text: 'אפשר לצלם את האריזה — והאפליקציה תמלא את הפרטים לבד.' }),
      el('button', { class: 'btn big', html: '＋ הוספת תרופה ראשונה', onclick: () => openMedEditor(null) })
    ]));
    return;
  }

  const pending = slots.filter(s => !s.status);
  const dueNow = pending.filter(s => s.at <= now);
  const later = pending.filter(s => s.at > now);
  const done = slots.filter(s => s.status);

  if (dueNow.length) {
    v.appendChild(sectionTitle('עכשיו', dueNow.length));
    dueNow.forEach(s => v.appendChild(doseCard(s, now)));
  }

  if (later.length) {
    v.appendChild(sectionTitle('בהמשך היום', later.length));
    later.forEach(s => v.appendChild(doseCard(s, now)));
  }

  if (!pending.length) {
    v.appendChild(el('div', { class: 'card', style: 'border-color:var(--ok);background:var(--ok-bg);text-align:center' }, [
      el('div', { style: 'font-size:2.6em', text: '✅' }),
      el('h2', { text: T.allDoneText(), style: 'margin:0' })
    ]));
  }

  if (done.length) {
    const details = el('details', { style: 'margin-top:18px' });
    details.appendChild(el('summary', {
      style: 'cursor:pointer;font-weight:700;padding:10px 0',
      text: 'מה שכבר סומן היום (' + done.length + ')'
    }));
    done.forEach(s => details.appendChild(doseCard(s, now)));
    v.appendChild(details);
  }
}

function sectionTitle(text, count) {
  return el('h2', { style: 'margin:22px 0 10px', text: text + (count ? ' · ' + count : '') });
}

function doseCard(slot, now) {
  const m = slot.med;
  const late = !slot.status && slot.at <= now;
  const veryLate = late && (now - slot.at) > 45 * 60000;

  const card = el('div', {
    class: 'dose' + (slot.status === 'taken' ? ' is-taken'
      : slot.status === 'skipped' ? ' is-skipped'
        : veryLate ? ' is-late' : late ? ' is-due' : ''),
    style: '--accent:' + (m.color || '#999'),
    onclick: () => openReminder(slot, 0)
  });

  const pic = el('div', { class: 'pic' });
  const ph = S.medPhoto(m);
  if (ph) pic.appendChild(el('img', { src: ph, alt: '' }));
  else pic.textContent = '💊';
  card.appendChild(pic);

  const mid = el('div');
  mid.appendChild(el('div', { class: 'name', text: m.name }));
  mid.appendChild(el('div', { class: 'amount', text: T.doseText(m) + (m.strength ? ' · ' + m.strength : '') }));
  const meta = el('div', { class: 'meta' });
  const cond = T.conditionText(m);
  if (cond) meta.appendChild(el('span', { class: 'badge due', text: cond }));
  if (slot.status === 'taken') meta.appendChild(el('span', { class: 'badge ok', text: '✓ נלקח' }));
  if (slot.status === 'skipped') meta.appendChild(el('span', { class: 'badge', text: 'דולג' }));
  if (veryLate) meta.appendChild(el('span', { class: 'badge danger', text: 'באיחור' }));
  if (meta.children.length) mid.appendChild(meta);
  card.appendChild(mid);

  const right = el('div', { class: 'right' });
  right.appendChild(el('div', { class: 'when', text: slot.time }));
  const chk = el('button', {
    class: 'check' + (slot.status === 'taken' ? ' done' : ''),
    html: slot.status === 'taken' ? '✓' : '○',
    'aria-label': 'סימון לקיחה',
    onclick: e => {
      e.stopPropagation();
      if (slot.status === 'taken') S.unmarkSlot(slot.id);
      else { S.markSlot(slot.id, 'taken'); N.chime('success'); N.clearNag(slot.id); }
    }
  });
  right.appendChild(chk);
  card.appendChild(right);
  return card;
}

function refillMed(med) {
  const add = med.supply.packSize || 30;
  promptBig('חידוש מלאי — ' + med.name, 'כמה יחידות יש עכשיו בסך הכול?', String((med.supply.countOnHand || 0) + add))
    .then(val => {
      if (val === null) return;
      const n = Number(val);
      if (isNaN(n)) { toast('מספר לא תקין', 'error'); return; }
      med.supply.countOnHand = Math.max(0, n);
      med.supply.lastRefill = S.ymd();
      S.upsertMed(med);
      toast('המלאי עודכן', 'ok');
    });
}

// ============================================================
//  מסך "תרופות"
// ============================================================
function renderMeds() {
  const v = $('#view-meds');
  v.innerHTML = '';
  v.appendChild(el('h1', { text: 'התרופות שלי' }));

  const addRow = el('div', { class: 'row', style: 'gap:10px;margin-bottom:18px' });
  addRow.appendChild(el('button', {
    class: 'btn grow big', html: '📷 צילום אריזה',
    onclick: () => openMedEditor(null, { startWithCamera: true })
  }));
  addRow.appendChild(el('button', {
    class: 'btn ghost grow big', html: '✍️ הקלדה',
    onclick: () => openMedEditor(null)
  }));
  v.appendChild(addRow);

  if (!S.state.meds.length) {
    v.appendChild(el('div', { class: 'empty' }, [
      el('div', { class: 'big', text: '💊' }),
      el('p', { text: 'הרשימה ריקה.' })
    ]));
    return;
  }

  const card = el('div', { class: 'card' });
  S.state.meds.slice().sort((a, b) => (b.active - a.active) || a.name.localeCompare(b.name, 'he')).forEach(m => {
    const sup = Sch.supplyInfo(m);
    const row = el('div', {
      class: 'med-row' + (m.active ? '' : ' off'),
      onclick: () => openMedEditor(m)
    });
    const pic = el('div', { class: 'pic' });
    const ph = S.medPhoto(m);
    if (ph) pic.appendChild(el('img', { src: ph, alt: '' }));
    else pic.textContent = '💊';
    row.appendChild(pic);

    const mid = el('div');
    mid.appendChild(el('div', { class: 'nm', text: m.name + (m.strength ? ' ' + m.strength : '') }));
    mid.appendChild(el('div', { class: 'small muted', text: Sch.scheduleText(m) }));
    const meta = el('div', { class: 'meta', style: 'margin-top:5px' });
    if (!m.active) meta.appendChild(el('span', { class: 'badge', text: 'לא פעילה' }));
    if (sup.tracked) {
      meta.appendChild(el('span', {
        class: 'badge ' + (sup.critical ? 'danger' : sup.low ? 'due' : ''),
        text: '📦 ' + (isFinite(sup.daysLeft) ? sup.daysLeft + ' ימים' : sup.count + ' יח׳')
      }));
    }
    if (m.info) meta.appendChild(el('span', { class: 'badge info', text: '📖 יש מידע' }));
    if (meta.children.length) mid.appendChild(meta);
    row.appendChild(mid);

    const acts = el('div', { class: 'row', style: 'gap:6px' });
    acts.appendChild(el('button', {
      class: 'tool-btn', html: 'ℹ️', 'aria-label': 'מידע על התרופה',
      onclick: e => { e.stopPropagation(); openDrugInfo(m); }
    }));
    acts.appendChild(el('button', {
      class: 'tool-btn danger', html: '🗑', 'aria-label': 'מחיקת התרופה',
      onclick: async e => {
        e.stopPropagation();
        const ok = await confirmBig('למחוק את ' + m.name + ' ואת כל היסטוריית הלקיחות שלה?', 'כן, למחוק', true);
        if (ok) { S.deleteMed(m.id); toast('נמחק', 'ok'); }
      }
    }));
    row.appendChild(acts);
    card.appendChild(row);
  });
  v.appendChild(card);
}

// ============================================================
//  מסך "מעקב"
// ============================================================
function renderTrack() {
  const v = $('#view-track');
  v.innerHTML = '';
  v.appendChild(el('h1', { text: 'מעקב' }));

  // היענות
  const a7 = Sch.adherence(7);
  const a30 = Sch.adherence(30);
  const c0 = el('div', { class: 'card' });
  c0.appendChild(el('div', { class: 'card-title', html: '<span class="ico">📈</span> היענות' }));
  const mkBar = (label, a) => {
    const box = el('div', { style: 'margin-bottom:12px' });
    box.appendChild(el('div', { class: 'row' }, [
      el('div', { class: 'grow', text: label }),
      el('b', { text: a.pct + '%  (' + a.taken + '/' + a.total + ')' })
    ]));
    const bar = el('div', { class: 'bar' + (a.pct < 70 ? ' low' : ''), style: 'margin-top:5px' });
    bar.appendChild(el('i', { style: 'width:' + a.pct + '%' }));
    box.appendChild(bar);
    return box;
  };
  c0.appendChild(mkBar('7 ימים אחרונים', a7));
  c0.appendChild(mkBar('30 יום אחרונים', a30));
  v.appendChild(c0);

  // לוח שבועי
  if (S.state.meds.filter(m => m.active).length) {
    const c1 = el('div', { class: 'card' });
    c1.appendChild(el('div', { class: 'card-title', html: '<span class="ico">🗓️</span> השבוע האחרון' }));
    const grid = el('div', { class: 'week' });
    grid.appendChild(el('div', { class: 'hd' }));
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = S.addDays(new Date(), -i);
      days.push(S.ymd(d));
      grid.appendChild(el('div', { class: 'hd', text: Sch.WEEKDAYS_SHORT[d.getDay()] }));
    }
    S.state.meds.filter(m => m.active).forEach(m => {
      grid.appendChild(el('div', { class: 'lbl', text: m.name, title: m.name }));
      days.forEach(ds => {
        const daySlots = Sch.slotsForDate(ds).filter(s => s.medId === m.id);
        let cls = 'none', txt = '·';
        if (daySlots.length) {
          const taken = daySlots.filter(s => s.status === 'taken').length;
          if (taken === daySlots.length) { cls = 'taken'; txt = '✓'; }
          else if (ds < S.ymd()) { cls = 'missed'; txt = taken ? taken + '/' + daySlots.length : '✕'; }
          else { cls = ''; txt = '○'; }
        }
        grid.appendChild(el('div', { class: 'cell ' + cls, text: txt }));
      });
    });
    c1.appendChild(grid);
    v.appendChild(c1);
  }

  // מלאי
  const tracked = S.state.meds.filter(m => m.active && Sch.supplyInfo(m).tracked);
  if (tracked.length) {
    const c2 = el('div', { class: 'card' });
    c2.appendChild(el('div', { class: 'card-title', html: '<span class="ico">📦</span> מלאי' }));
    tracked.forEach(m => {
      const s = Sch.supplyInfo(m);
      const row = el('div', { class: 'row', style: 'margin-bottom:10px' });
      row.appendChild(el('div', { class: 'grow' }, [
        el('div', { html: '<b>' + esc(m.name) + '</b>' }),
        el('div', {
          class: 'small muted',
          text: s.count + ' יחידות · ' + (isFinite(s.daysLeft) ? 'מספיק ל־' + s.daysLeft + ' ימים' : 'לא בשימוש קבוע') +
            (s.outDate && isFinite(s.daysLeft) ? ' (עד ' + s.outDate + ')' : '')
        })
      ]));
      row.appendChild(el('button', { class: 'btn ghost', text: 'עדכון', onclick: () => refillMed(m) }));
      c2.appendChild(row);
    });
    v.appendChild(c2);
  }

  // פרוצדורות
  const c3 = el('div', { class: 'card' });
  c3.appendChild(el('div', { class: 'card-title', html: '<span class="ico">🩺</span> בדיקות ותורים' }));
  const active = Sch.activeProcedures();
  if (!active.length) c3.appendChild(el('p', { class: 'muted', text: 'אין בדיקות מתוכננות.' }));
  active.forEach(p => {
    const st = Sch.procedureState(p);
    c3.appendChild(el('div', {
      class: 'row', style: 'margin-bottom:10px;cursor:pointer', onclick: () => openProcedureEditor(p)
    }, [
      el('div', { class: 'grow' }, [
        el('div', { html: '<b>' + esc(p.title) + '</b>' }),
        el('div', { class: 'small muted', text: p.dueDate + (p.repeatMonths ? ' · כל ' + p.repeatMonths + ' חודשים' : '') })
      ]),
      el('span', { class: 'badge ' + (st.overdue ? 'danger' : st.soon ? 'due' : ''), text: st.label })
    ]));
  });
  c3.appendChild(el('button', {
    class: 'btn ghost block', html: '＋ בדיקה או תור חדש', style: 'margin-top:10px',
    onclick: () => openProcedureEditor(null)
  }));
  v.appendChild(c3);

  // החמצות
  const missed = Sch.missedSlots();
  if (missed.length) {
    const c4 = el('div', { class: 'card', style: 'border-color:var(--danger)' });
    c4.appendChild(el('div', { class: 'card-title', html: '<span class="ico">⚠️</span> מנות שלא סומנו' }));
    missed.slice(0, 12).forEach(s => {
      c4.appendChild(el('div', { class: 'row', style: 'margin-bottom:8px' }, [
        el('div', { class: 'grow', text: s.med.name + ' · ' + s.dateStr + ' ' + s.time }),
        el('button', { class: 'btn ghost', text: '✓ לקחתי', onclick: () => { S.markSlot(s.id, 'taken'); N.chime('success'); } }),
        el('button', { class: 'btn ghost', text: 'דילגתי', onclick: () => S.markSlot(s.id, 'skipped') })
      ]));
    });
    v.appendChild(c4);
  }
}

// ============================================================
//  מסך "הערות"
// ============================================================
function renderNotes() {
  const v = $('#view-notes');
  v.innerHTML = '';
  v.appendChild(el('h1', { text: 'הערות' }));

  const box = el('div', { class: 'card' });
  const ta = el('textarea', { placeholder: 'מה חשוב לזכור? שאלות לרופא, תופעות שהרגשת, שינויים במינון…' });
  box.appendChild(ta);
  box.appendChild(el('button', {
    class: 'btn block', text: '＋ הוספת הערה', style: 'margin-top:10px',
    onclick: () => {
      const t = ta.value.trim();
      if (!t) return;
      S.state.notes.unshift({ id: S.uid(), text: t, at: Date.now() });
      S.save();
      ta.value = '';
      toast('נשמר', 'ok');
    }
  }));
  v.appendChild(box);

  if (!S.state.notes.length) {
    v.appendChild(el('div', { class: 'empty' }, [el('div', { class: 'big', text: '📝' }), el('p', { text: 'עוד אין הערות.' })]));
    return;
  }

  S.state.notes.forEach(n => {
    const item = el('div', { class: 'note-item' });
    item.appendChild(el('div', { class: 'when', text: new Date(n.at).toLocaleString('he-IL', { dateStyle: 'medium', timeStyle: 'short' }) }));
    item.appendChild(el('div', { class: 'txt', text: n.text }));
    item.appendChild(el('button', {
      class: 'btn ghost small', text: '🗑 מחיקה', style: 'margin-top:8px;min-height:42px;padding:6px 14px',
      onclick: async () => {
        const ok = await confirmBig('למחוק את ההערה?', 'למחוק', true);
        if (ok) { S.state.notes = S.state.notes.filter(x => x.id !== n.id); S.save(); }
      }
    }));
    v.appendChild(item);
  });
}

// ============================================================
//  מסך "הגדרות"
// ============================================================
function renderSettings() {
  const v = $('#view-settings');
  v.innerHTML = '';
  const st = S.state.settings;
  v.appendChild(el('h1', { text: 'הגדרות' }));

  const card = (icon, title) => {
    const c = el('div', { class: 'card' });
    c.appendChild(el('div', { class: 'card-title', html: '<span class="ico">' + icon + '</span> ' + esc(title) }));
    v.appendChild(c);
    return c;
  };
  const bind = (input, path, transform) => {
    input.addEventListener('change', () => {
      const parts = path.split('.');
      let o = st;
      for (let i = 0; i < parts.length - 1; i++) o = o[parts[i]];
      let val = input.type === 'checkbox' ? input.checked : input.value;
      if (transform) val = transform(val);
      o[parts[parts.length - 1]] = val;
      S.save();
    });
  };
  const fieldIn = (parent, label, input, hint) => {
    parent.appendChild(el('label', { class: 'field' }, [
      el('span', { class: 'lbl', text: label }), input, hint ? el('div', { class: 'hint', text: hint }) : null
    ]));
    return input;
  };
  const checkIn = (parent, label, checked, onchange) => {
    const cb = el('input', { type: 'checkbox' });
    cb.checked = !!checked;
    cb.addEventListener('change', () => onchange(cb.checked));
    parent.appendChild(el('label', { class: 'checkline' }, [cb, el('span', { text: label })]));
    return cb;
  };

  // ---------- הגדרה מהירה — תמיד ראשון ----------
  // המסך הזה גדל ל-8 כרטיסים, והדברים הקריטיים נקברו בגלילה.
  // הרשימה הזאת מראה מה עוד לא מוגדר, ונותנת כפתור ישיר לכל אחד.
  const steps = [
    {
      label: 'השם שלך ולשון הפנייה',
      done: !!st.userName,
      hint: 'כדי שהתזכורת תפנה אלייך בשם',
      btn: 'הגדרה', run: () => scrollToCard('c-personal')
    },
    {
      label: 'אישורים (התראות, מצלמה, מיקום)',
      done: permsSummary && permsSummary.granted === permsSummary.total,
      hint: permsSummary
        ? (permsSummary.missingRequired ? 'ההתראות עוד לא אושרו — בלי זה לא תוצג שום תזכורת'
          : 'אושרו ' + permsSummary.granted + ' מתוך ' + permsSummary.total)
        : 'בודק…',
      btn: 'אישור הכול', run: () => openPermissions(false)
    },
    {
      label: 'תזכורות כשהאפליקציה סגורה',
      done: !!st.push.enabled,
      hint: 'זה מה שגורם לתזכורת להגיע גם כשהטלפון נעול',
      btn: '▶ הפעלה',
      run: async e => {
        const b = e.currentTarget;
        b.disabled = true; b.innerHTML = '<span class="busy"></span>';
        try {
          const r = await Push.enable(st.push.server);
          try { await Push.testPush(); } catch (e2) { /* לא קריטי */ }
          toast('הופעל! נרשמו ' + r.slots + ' תזכורות. שלחתי התראת בדיקה — היא אמורה להופיע עכשיו.', 'ok', true);
        } catch (err) { toast(err.message, 'error', true); }
        render();
      }
    },
    {
      label: 'אייקון במסך הבית',
      done: Install.isInstalled(),
      hint: 'כדי לפתוח בלחיצה אחת, בלי לחפש בדפדפן',
      btn: 'התקנה', run: () => openInstallHelp()
    },
    {
      label: 'מפתח Gemini',
      done: !!st.geminiKey,
      hint: 'לצילום אריזה שממלא לבד, ולמידע על התרופה',
      btn: 'איך עושים?', run: () => openGeminiSetup()
    }
  ];

  const pending = steps.filter(s => !s.done);
  const cSetup = el('div', {
    class: 'card',
    style: pending.length
      ? 'border-color:var(--due);background:var(--due-bg)'
      : 'border-color:var(--ok);background:var(--ok-bg)'
  });
  cSetup.appendChild(el('div', {
    class: 'card-title',
    html: pending.length
      ? '<span class="ico">🧭</span> נשאר להגדיר ' + pending.length
      : '<span class="ico">✅</span> הכול מוגדר'
  }));
  steps.forEach(s => {
    const row = el('div', { class: 'setup-row' + (s.done ? ' done' : '') });
    row.appendChild(el('span', { class: 'setup-mark', text: s.done ? '✓' : '○' }));
    row.appendChild(el('div', { class: 'grow' }, [
      el('div', { class: 'setup-label', text: s.label }),
      s.done ? null : el('div', { class: 'hint', style: 'margin:0', text: s.hint })
    ]));
    if (!s.done) row.appendChild(el('button', { class: 'btn', style: 'min-height:46px;padding:8px 16px', html: s.btn, onclick: s.run }));
    cSetup.appendChild(row);
  });
  v.appendChild(cSetup);

  // ---------- אישי ----------
  const c1 = card('👤', 'אישי');
  c1.id = 'c-personal';
  const nameIn = fieldIn(c1, 'איך לקרוא לך?', el('input', { type: 'text', placeholder: 'למשל: יהודית' }),
    'האפליקציה תפנה אלייך בשם הזה בכל תזכורת.');
  nameIn.value = st.userName;
  bind(nameIn, 'userName', x => x.trim());
  nameIn.addEventListener('change', () => render());

  const gRow = el('div', { class: 'chips', style: 'margin-bottom:14px' });
  [{ v: 'f', l: 'לשון נקבה' }, { v: 'm', l: 'לשון זכר' }].forEach(o => {
    gRow.appendChild(el('button', {
      class: 'chip' + (st.gender === o.v ? ' on' : ''), text: o.l,
      onclick: () => { st.gender = o.v; S.save(); render(); }
    }));
  });
  c1.appendChild(el('div', { class: 'lbl', text: 'איך לפנות אלייך', style: 'font-weight:700;margin-bottom:6px' }));
  c1.appendChild(gRow);

  // סגנון הפנייה
  c1.appendChild(el('div', { class: 'lbl', text: 'איך שהאפליקציה מדברת אלייך', style: 'font-weight:700;margin-bottom:6px' }));
  const toneWrap = el('div', { style: 'margin-bottom:16px' });
  Object.keys(T.TONES).forEach(k => {
    const on = T.tone() === k;
    const row = el('button', {
      class: 'tone-opt' + (on ? ' on' : ''),
      onclick: () => { st.tone = k; S.save(); render(); toast(T.praise(), 'ok'); }
    }, [
      el('span', { class: 'tone-mark', text: on ? '●' : '○' }),
      el('div', { class: 'grow', style: 'text-align:start' }, [
        el('div', { style: 'font-weight:800', text: T.TONES[k].label }),
        el('div', { class: 'hint', style: 'margin:0', text: T.TONES[k].hint })
      ])
    ]);
    toneWrap.appendChild(row);
  });
  c1.appendChild(toneWrap);
  const sample = S.state.meds[0];
  if (sample) {
    c1.appendChild(el('div', {
      class: 'ai-status', style: 'margin-bottom:16px',
      html: '<div class="hint" style="margin:0 0 4px">כך זה יישמע:</div><b>' +
        esc(T.reminderTitle(sample, 'preview')) + '</b>'
    }));
  }

  const fs = fieldIn(c1, 'גודל הכתב: ' + Math.round((st.fontScale || 1) * 100) + '%',
    el('input', { type: 'range', min: 0.85, max: 1.6, step: 0.05 }));
  fs.value = st.fontScale || 1;
  fs.addEventListener('input', () => {
    st.fontScale = Number(fs.value);
    document.documentElement.style.setProperty('--fs', st.fontScale);
    fs.parentElement.querySelector('.lbl').textContent = 'גודל הכתב: ' + Math.round(st.fontScale * 100) + '%';
  });
  fs.addEventListener('change', () => S.save());

  // ערכת צבעים
  c1.appendChild(el('div', { class: 'lbl', text: 'ערכת צבעים', style: 'font-weight:700;margin-bottom:6px' }));
  const palRow = el('div', { class: 'chips', style: 'margin-bottom:6px' });
  [
    { v: 'auto', l: 'לפי הפנייה', sw: null },
    { v: 'f', l: 'ורוד־סגול', sw: '#9c3a74' },
    { v: 'm', l: 'תכלת־כחול', sw: '#15608f' }
  ].forEach(o => {
    const chip = el('button', {
      class: 'chip' + ((st.palette || 'auto') === o.v ? ' on' : ''),
      onclick: () => { st.palette = o.v; S.save(); render(); }
    });
    if (o.sw) chip.appendChild(el('span', { class: 'swatch', style: 'background:' + o.sw }));
    chip.appendChild(document.createTextNode(o.l));
    palRow.appendChild(chip);
  });
  c1.appendChild(palRow);
  c1.appendChild(el('div', {
    class: 'hint', style: 'margin-bottom:16px',
    text: (st.palette || 'auto') === 'auto'
      ? 'כרגע: ' + (activePalette() === 'f' ? 'ורוד־סגול (לשון נקבה)' : 'תכלת־כחול (לשון זכר)') +
        '. שינוי לשון הפנייה ישנה גם את הצבעים.'
      : 'נבחרה ידנית, ולא תשתנה עם לשון הפנייה.'
  }));

  const themeRow = el('div', { class: 'chips' });
  [{ v: 'auto', l: 'אוטומטי' }, { v: 'light', l: 'בהיר' }, { v: 'dark', l: 'כהה' }].forEach(o => {
    themeRow.appendChild(el('button', {
      class: 'chip' + (st.theme === o.v ? ' on' : ''), text: o.l,
      onclick: () => { st.theme = o.v; S.save(); render(); }
    }));
  });
  c1.appendChild(el('div', { class: 'lbl', text: 'מראה', style: 'font-weight:700;margin-bottom:6px' }));
  c1.appendChild(themeRow);

  // ---------- תזכורות ----------
  const c2 = card('🔔', 'תזכורות');
  const permTxt = { granted: '✅ התראות מאושרות', denied: '⛔ ההתראות חסומות בדפדפן', default: 'ההתראות עוד לא אושרו', unsupported: 'הדפדפן לא תומך בהתראות' }[N.permission()];
  c2.appendChild(el('p', { text: permTxt }));
  if (N.permission() !== 'granted') {
    c2.appendChild(el('button', {
      class: 'btn block', text: '🔔 אישור התראות',
      onclick: async () => { await N.requestPermission(); render(); }
    }));
    c2.appendChild(el('div', { class: 'spacer' }));
  }

  checkIn(c2, 'הקראה קולית של התזכורות', st.voiceEnabled, x => { st.voiceEnabled = x; S.save(); });
  const rate = fieldIn(c2, 'מהירות הדיבור', el('input', { type: 'range', min: 0.6, max: 1.3, step: 0.05 }));
  rate.value = st.voiceRate;
  rate.addEventListener('change', () => { st.voiceRate = Number(rate.value); S.save(); N.speak('כך אני אשמע', true); });

  const nagIn = fieldIn(c2, 'כל כמה דקות לנדנד אם לא סומן', el('input', { type: 'number', min: 2, max: 60, inputmode: 'numeric' }));
  nagIn.value = st.nagIntervalMin;
  bind(nagIn, 'nagIntervalMin', x => Math.max(2, Number(x) || 7));

  const nagMax = fieldIn(c2, 'עד כמה שעות אחרי הזמן להמשיך לנדנד', el('input', { type: 'number', min: 1, max: 12, inputmode: 'numeric' }));
  nagMax.value = st.nagMaxHours;
  bind(nagMax, 'nagMaxHours', x => Math.max(1, Number(x) || 5));

  const snz = fieldIn(c2, 'אפשרויות נודניק (דקות, מופרד בפסיק)', el('input', { type: 'text', inputmode: 'numeric' }));
  snz.value = (st.snoozeOptions || []).join(', ');
  snz.addEventListener('change', () => {
    const arr = snz.value.split(',').map(x => Number(x.trim())).filter(x => x > 0).slice(0, 4);
    st.snoozeOptions = arr.length ? arr : [5, 10, 20, 60];
    snz.value = st.snoozeOptions.join(', ');
    S.save();
  });

  c2.appendChild(el('button', {
    class: 'btn ghost block', text: '🔊 בדיקת תזכורת',
    onclick: () => {
      N.primeMedia();
      const m = S.state.meds[0];
      if (!m) { toast('קודם הוסיפי תרופה אחת', 'warn'); return; }
      N.chime('gentle');
      N.speak(T.reminderSpeech(m), true);
      toast('כך תישמע התזכורת', 'ok');
    }
  }));

  // ---------- תזכורות גם כשהאפליקציה סגורה ----------
  const cP = card('📲', 'תזכורות כשהאפליקציה סגורה');
  cP.appendChild(el('p', {
    class: 'small muted',
    text: 'זה מה שגורם לתזכורת לקפוץ עם התמונה גם כשהטלפון נעול והאפליקציה סגורה, ולחזור עד שמסמנים. ' +
      'לשרת עוברים רק תאריכים ושעות — שמות התרופות והתמונות נשארים בטלפון.'
  }));

  const srvIn = fieldIn(cP, 'כתובת שרת התזכורות', el('input', { type: 'text', placeholder: 'https://…workers.dev', inputmode: 'url', autocapitalize: 'off' }));
  srvIn.value = st.push.server || '';
  srvIn.addEventListener('change', () => { st.push.server = srvIn.value.trim().replace(/\/+$/, ''); S.save(); });

  const pStatus = el('div', { class: 'ai-status', style: 'margin-bottom:12px' });
  cP.appendChild(pStatus);

  function paintPush() {
    Push.status().then(s => {
      const rows = [];
      rows.push(s.enabled && s.subscribed ? '<b>✅ מופעל במכשיר</b>' : s.server ? '<b>לא מופעל</b>' : '<b>לא הוגדר שרת</b>');
      if (s.lastSync) rows.push('סונכרן: ' + new Date(s.lastSync).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' }));
      pStatus.className = 'ai-status ' + (s.enabled && s.subscribed ? 'ok' : s.server ? 'warn' : '');
      pStatus.innerHTML = rows.join('<br>');

      if (!s.enabled) return;
      // האמת היחידה שחשובה: האם השרת באמת מסוגל לשלוח אליי עכשיו
      Push.verify(false).then(v => {
        if (!v) return;
        if (v.error) {
          pStatus.innerHTML += '<br><span style="color:var(--danger)">⚠️ אין קשר לשרת: ' + esc(v.error) + '</span>';
          return;
        }
        if (!v.exists || v.dead) {
          pStatus.className = 'ai-status warn';
          pStatus.style.borderColor = 'var(--danger)';
          pStatus.innerHTML = '<div class="ai-head" style="color:var(--danger)">⚠️ התזכורות מנותקות</div>' +
            '<p class="small">' + esc(v.dead ? (v.deadReason || 'המנוי פג') : 'השרת לא מכיר את המכשיר הזה') +
            '. שום תזכורת לא תישלח עד שמחדשים.</p>';
          const fix = el('button', {
            class: 'btn danger block', style: 'margin-top:10px', text: '🔄 חידוש החיבור',
            onclick: async e => {
              const b = e.currentTarget; b.disabled = true; b.innerHTML = '<span class="busy"></span> מחדש…';
              try {
                await Push.resubscribe();
                try { await Push.testPush(); } catch (e2) { /* ignore */ }
                toast('חודש. שלחתי התראת בדיקה — היא אמורה להופיע עכשיו.', 'ok', true);
              } catch (err) { toast(err.message, 'error', true); }
              render();
            }
          });
          pStatus.appendChild(fix);
          return;
        }
        const bits = [];
        if (v.nextSlot) bits.push('התזכורת הבאה בשרת: ' + v.nextSlot.replace('|', ' בשעה '));
        if (v.lastSlot) {
          const daysLeft = S.daysBetween(new Date(), S.parseYmd(v.lastSlot.split('|')[0]));
          bits.push('רשומות עד ' + v.lastSlot.split('|')[0] + (daysLeft <= 5 ? ' ⚠️ (כדאי לפתוח שוב כדי לחדש)' : ''));
        }
        if (v.lastSentAt) bits.push('נשלחה אחרונה: ' + new Date(v.lastSentAt).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' }));
        pStatus.innerHTML += '<br><span class="small muted">' + bits.join('<br>') + '</span>';
      }).catch(() => { });

      Push.checkServer().then(info => {
        if (!info.lastCron) return;
        const ago = Sch.agoText(Date.now() - new Date(info.lastCron).getTime());
        pStatus.innerHTML += '<br><span class="small muted">השרת רץ ' + esc(ago) + '</span>';
      }).catch(() => {
        pStatus.innerHTML += '<br><span class="small" style="color:var(--danger)">⚠️ השרת לא עונה</span>';
      });
    }).catch(() => { pStatus.textContent = '—'; });
  }

  paintPush();

  const pRow = el('div', { class: 'row', style: 'gap:8px;flex-wrap:wrap' });
  pRow.appendChild(el('button', {
    class: 'btn ghost grow', text: 'בדיקת השרת',
    onclick: async e => {
      const b = e.currentTarget; b.disabled = true; b.innerHTML = '<span class="busy"></span> בודק…';
      try { const j = await Push.checkServer(srvIn.value.trim()); toast('השרת עונה · ' + j.build, 'ok', true); }
      catch (err) { toast(err.message, 'error', true); }
      b.disabled = false; b.textContent = 'בדיקת השרת';
    }
  }));
  pRow.appendChild(el('button', {
    class: 'btn ' + (st.push.enabled ? 'ghost' : '') + ' grow',
    text: st.push.enabled ? 'כיבוי' : '▶ הפעלה',
    onclick: async e => {
      const b = e.currentTarget; b.disabled = true;
      try {
        if (st.push.enabled) { await Push.disable(); toast('כובה', 'ok'); }
        else {
          b.innerHTML = '<span class="busy"></span> מפעיל…';
          const r = await Push.enable(srvIn.value.trim());
          toast('הופעל · נרשמו ' + r.slots + ' תזכורות', 'ok', true);
        }
      } catch (err) { toast(err.message, 'error', true); }
      b.disabled = false;
      render();
    }
  }));
  cP.appendChild(pRow);

  if (st.push.enabled) {
    cP.appendChild(el('button', {
      class: 'btn ghost block', style: 'margin-top:10px', text: '🔔 שליחת דחיפת בדיקה עכשיו',
      onclick: async e => {
        const b = e.currentTarget; b.disabled = true; b.innerHTML = '<span class="busy"></span> שולח…';
        try { await Push.testPush(); toast('נשלח. סגרי את האפליקציה — ההתראה אמורה להגיע גם ככה.', 'ok', true); }
        catch (err) { toast(err.message, 'error', true); }
        b.disabled = false; b.textContent = '🔔 שליחת דחיפת בדיקה עכשיו';
      }
    }));
    cP.appendChild(el('button', {
      class: 'btn ghost block', style: 'margin-top:10px', text: '🔄 סנכרון לוח התזכורות',
      onclick: async e => {
        const b = e.currentTarget; b.disabled = true; b.innerHTML = '<span class="busy"></span> מסנכרן…';
        try { const r = await Push.sync(); toast('סונכרנו ' + r.slots + ' תזכורות, עד ' + r.lastSlot, 'ok', true); paintPush(); }
        catch (err) { toast(err.message, 'error', true); }
        b.disabled = false; b.textContent = '🔄 סנכרון לוח התזכורות';
      }
    }));
  }

  // ---------- אבחון: למה תזכורת לא הגיעה ----------
  const cD = card('🔎', 'בדיקת תזכורות');
  cD.appendChild(el('div', {
    class: 'ai-status ' + (st.push.enabled ? 'ok' : 'warn'),
    style: 'margin-bottom:14px',
    html: st.push.enabled
      ? '<div class="ai-head">✅ תזכורות שרת פעילות</div>' +
        '<p class="small">התזכורת נשלחת מהשרת, ולכן היא מגיעה עם התמונה גם כשהאפליקציה סגורה והטלפון נעול, ' +
        'וחוזרת עד שמסמנים. הבדיקות למטה נשארות שימושיות לאבחון.</p>'
      : '<div class="ai-head">חשוב להבין איך זה עובד</div>' +
        '<p class="small">בלי שרת תזכורות, התזכורות רצות <b>בתוך האפליקציה עצמה</b>. כשהיא סגורה, ' +
        'או אחרי שהיא ברקע זמן ממושך, מערכת ההפעלה מקפיאה אותה — ואז <b>לא תגיע התראה בזמן</b>. ' +
        'זו מגבלה של דפדפנים, לא תקלה באפליקציה.</p>' +
        '<p class="small" style="margin-top:6px">הפתרון נמצא בכרטיס <b>"תזכורות כשהאפליקציה סגורה"</b> שמעל.</p>'
  }));

  const diag = el('div', { class: 'diag' });
  const line = (label, val, good) => {
    diag.appendChild(el('div', { class: 'diag-row' }, [
      el('span', { class: 'diag-k', text: label }),
      el('span', { class: 'diag-v ' + (good === true ? 'ok' : good === false ? 'bad' : ''), text: val })
    ]));
  };
  const perm = N.permission();
  line('הרשאת התראות', { granted: 'מאושרת ✓', denied: 'חסומה ✗', default: 'לא אושרה', unsupported: 'לא נתמכת' }[perm], perm === 'granted');
  line('Service Worker', N.hasServiceWorker() ? 'רשום ✓' : 'לא רשום ✗', N.hasServiceWorker());
  const standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  line('מותקנת במסך הבית', standalone ? 'כן ✓' : 'לא — פתוחה בדפדפן', standalone);

  const prev = N.previousRunAt;
  line('האפליקציה רצה לאחרונה', prev
    ? new Date(prev).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' }) + ' (' + Sch.agoText(Date.now() - prev) + ')'
    : 'זו ההפעלה הראשונה', null);

  const nx = Sch.nextSlot();
  line('התזכורת הבאה', nx ? nx.med.name + ' · ' + nx.time + (nx.dateStr !== S.ymd() ? ' (' + nx.dateStr + ')' : ' היום') : 'אין מתוכננת', null);
  const un = Sch.unmarkedSlots().length;
  line('מנות שלא סומנו', un ? String(un) : 'אין', un === 0);
  const nv = Nav.debug();
  line('כפתור "חזור"', nv.armed ? 'פעיל ✓' : (nv.started ? 'לא דרוך ✗' : 'לא אותחל ✗'), !!nv.armed);
  cD.appendChild(diag);

  if (prev) {
    cD.appendChild(el('p', {
      class: 'hint', style: 'margin-top:10px',
      text: 'אם השעה שלמעלה מאוחרת מהתזכורת שפספסת — זו ההוכחה שהאפליקציה פשוט לא רצה באותו רגע.'
    }));
  }

  cD.appendChild(el('button', {
    class: 'btn ghost block', style: 'margin-top:12px', html: '👁️ הצגת התראה לדוגמה (כמו שהיא תיראה)',
    onclick: async e => {
      const nx = Sch.nextSlot() || Sch.unmarkedSlots()[0];
      if (!nx) { toast('אין מנה להדגים. הוסיפי תרופה עם שעה.', 'warn'); return; }
      try { await Push.simulate(nx.dateStr, nx.time); toast('ההתראה הוצגה — הסתכלי במרכז ההתראות', 'ok', true); }
      catch (err) { toast(err.message, 'error', true); }
    }
  }));

  cD.appendChild(el('button', {
    class: 'btn ghost block', style: 'margin-top:10px', text: '🔔 התראת בדיקה בעוד 30 שניות',
    onclick: async e => {
      const b = e.currentTarget;
      if (await N.requestPermission() !== 'granted') { toast('צריך לאשר התראות קודם', 'warn'); render(); return; }
      N.testNotificationIn(30);
      b.disabled = true; b.textContent = 'נשלחה בקשה — סגרי עכשיו את האפליקציה';
      toast('סגרי את האפליקציה לגמרי. אם ההתראה לא תגיע תוך 30 שניות — זו בדיוק הבעיה.', 'warn', true);
    }
  }));

  cD.appendChild(el('button', {
    class: 'btn block', style: 'margin-top:10px', html: '📅 ייצוא ליומן של הטלפון',
    onclick: () => {
      const n = ICS.downloadIcs();
      if (!n) { toast('אין תרופות עם שעות קבועות לייצוא', 'warn'); return; }
      toast('יוצאו ' + n + ' תזכורות. פתחי את הקובץ והוסיפי אותו ליומן.', 'ok', true);
    }
  }));
  cD.appendChild(el('p', {
    class: 'hint',
    text: 'נוצר קובץ יומן עם תזכורת חוזרת לכל תרופה. פותחים אותו בטלפון ומוסיפים ליומן — ומאותו רגע היומן מזכיר בזמן, גם כשהאפליקציה סגורה. אחרי שינוי תרופות כדאי לייצא שוב.'
  }));

  // ---------- ימים שקטים ----------
  const c3 = card('🕯️', 'ימים שקטים (שבת וחג)');
  c3.appendChild(el('p', { class: 'small muted', text: 'ביום שקט אין נודניק ואין התראות חוזרות — רק כמה הודעות קוליות בשעות שתקבעי, ומסך גדול שאפשר להשאיר פתוח.' }));
  const qRow = el('div', { class: 'chips', style: 'margin-bottom:14px' });
  Sch.WEEKDAYS.forEach((name, i) => {
    qRow.appendChild(el('button', {
      class: 'chip quiet' + ((st.quietWeekdays || []).indexOf(i) !== -1 ? ' on' : ''), text: name,
      onclick: e => {
        const arr = st.quietWeekdays || [];
        const k = arr.indexOf(i);
        if (k === -1) arr.push(i); else arr.splice(k, 1);
        st.quietWeekdays = arr; S.save();
        e.currentTarget.classList.toggle('on');
      }
    }));
  });
  c3.appendChild(qRow);

  const annTimes = fieldIn(c3, 'שעות ההודעה הקולית', el('input', { type: 'text', placeholder: '09:00, 19:00' }));
  annTimes.value = (st.quiet.announceTimes || []).join(', ');
  annTimes.addEventListener('change', () => {
    st.quiet.announceTimes = annTimes.value.split(',').map(x => x.trim()).filter(x => /^\d{1,2}:\d{2}$/.test(x))
      .map(x => x.length === 4 ? '0' + x : x).sort();
    annTimes.value = st.quiet.announceTimes.join(', ');
    S.save();
  });
  const annMax = fieldIn(c3, 'כמה הודעות קוליות לכל היותר', el('input', { type: 'number', min: 1, max: 5, inputmode: 'numeric' }));
  annMax.value = st.quiet.maxAnnouncements;
  bind(annMax, 'quiet.maxAnnouncements', x => Math.max(1, Number(x) || 2));

  c3.appendChild(el('button', { class: 'btn block', html: '🕯️ פתיחת מסך שבת עכשיו', onclick: openShabbat }));

  // ---------- התראות חכמות ----------
  const c4 = card('📡', 'התראות שתלויות במצב');
  c4.appendChild(el('p', { class: 'small muted', text: 'עובד כשהאפליקציה פתוחה או פועלת ברקע בטלפון.' }));

  c4.appendChild(el('h3', { text: '☀️ תזכורת בהשכמה', style: 'margin-top:6px' }));
  checkIn(c4, 'לזהות שקמת לפי תנועת הטלפון', st.wake.enabled, async x => {
    st.wake.enabled = x; S.save();
    try { await Sensors.applySettings(); if (x) toast('מאזין לתנועה', 'ok'); }
    catch (e) { toast(e.message, 'error'); }
  });
  const wkRow = el('div', { class: 'row', style: 'gap:10px' });
  const wf = el('input', { type: 'number', min: 0, max: 23, inputmode: 'numeric' }); wf.value = st.wake.fromHour;
  const wt = el('input', { type: 'number', min: 0, max: 23, inputmode: 'numeric' }); wt.value = st.wake.toHour;
  bind(wf, 'wake.fromHour', x => Number(x) || 6);
  bind(wt, 'wake.toHour', x => Number(x) || 11);
  wkRow.appendChild(el('label', { class: 'field grow' }, [el('span', { class: 'lbl', text: 'משעה' }), wf]));
  wkRow.appendChild(el('label', { class: 'field grow' }, [el('span', { class: 'lbl', text: 'עד שעה' }), wt]));
  c4.appendChild(wkRow);
  c4.appendChild(el('button', {
    class: 'btn ghost block', text: 'בדיקת תזכורת השכמה',
    onclick: () => { N.primeMedia(); Sensors.testWake(); toast('נשלחה תזכורת ניסיון', 'ok'); }
  }));

  c4.appendChild(el('h3', { text: '🚪 תזכורת ביציאה מהבית', style: 'margin-top:20px' }));
  c4.appendChild(el('p', {
    class: 'small muted',
    text: st.leaveHome.lat === null ? 'עוד לא סומן איפה הבית.'
      : 'הבית מסומן. רדיוס ' + st.leaveHome.radiusM + ' מטר.'
  }));
  checkIn(c4, 'להזכיר לקחת תרופות כשיוצאים מהבית', st.leaveHome.enabled, async x => {
    st.leaveHome.enabled = x; S.save();
    try { await Sensors.applySettings(); } catch (e) { toast(e.message, 'error'); }
    render();
  });
  const radIn = fieldIn(c4, 'רדיוס הבית (מטרים)', el('input', { type: 'number', min: 50, max: 2000, step: 50, inputmode: 'numeric' }));
  radIn.value = st.leaveHome.radiusM;
  bind(radIn, 'leaveHome.radiusM', x => Math.max(50, Number(x) || 250));
  const lookIn = fieldIn(c4, 'להזכיר על תרופות שתוכננו בשעות הקרובות', el('input', { type: 'number', min: 1, max: 24, inputmode: 'numeric' }));
  lookIn.value = st.leaveHome.lookaheadHours;
  bind(lookIn, 'leaveHome.lookaheadHours', x => Math.max(1, Number(x) || 10));
  c4.appendChild(el('button', {
    class: 'btn block', html: '📍 הבית שלי נמצא כאן',
    onclick: async e => {
      const b = e.currentTarget;
      b.disabled = true; b.innerHTML = '<span class="busy"></span> מאתר…';
      try { await Sensors.setHomeHere(); toast('המיקום נשמר', 'ok'); render(); }
      catch (err) { toast(err.message, 'error'); b.disabled = false; b.innerHTML = '📍 הבית שלי נמצא כאן'; }
    }
  }));

  // ---------- Gemini ----------
  const c5 = card('✨', 'זיהוי מצילום ומידע על תרופות');
  c5.appendChild(el('p', {
    class: 'small muted',
    text: 'שתי היכולות האלה משתמשות ב-Gemini של גוגל. המפתח נשמר רק במכשיר הזה ולא נשלח לשום מקום אחר.'
  }));
  const keyIn = fieldIn(c5, 'מפתח Gemini', el('input', { type: 'password', placeholder: 'AIza…', autocomplete: 'off' }),
    'משיגים חינם ב־aistudio.google.com/apikey');
  keyIn.value = st.geminiKey;
  bind(keyIn, 'geminiKey', x => x.trim());
  const modelIn = fieldIn(c5, 'מודל', el('input', { type: 'text' }));
  modelIn.value = st.geminiModel;
  bind(modelIn, 'geminiModel', x => x.trim() || 'gemini-3.8-flash');
  checkIn(c5, 'לחתוך תמונות אוטומטית לאזור הרלוונטי', st.autoCrop, x => { st.autoCrop = x; S.save(); });
  c5.appendChild(el('div', { class: 'hint', style: 'margin:-8px 0 12px', text: 'אחרי צילום, האפליקציה מוצאת את האריזה או הכדור בתמונה וחותכת סביבם — כך הם נראים גדולים וברורים בתזכורת.' }));
  c5.appendChild(el('button', {
    class: 'btn ghost block', text: 'בדיקת המפתח',
    onclick: async e => {
      const b = e.currentTarget;
      b.disabled = true; b.innerHTML = '<span class="busy"></span> בודק…';
      try { await G.testKey(); toast('המפתח עובד ✓', 'ok'); }
      catch (err) { toast(err.message, 'error', true); }
      b.disabled = false; b.textContent = 'בדיקת המפתח';
    }
  }));

  // ---------- נתונים ----------
  const c6 = card('💾', 'הנתונים שלי');
  c6.appendChild(el('p', { class: 'small muted', text: 'הכול נשמר רק במכשיר הזה. כדאי לייצא גיבוי מדי פעם.' }));
  c6.appendChild(el('button', {
    class: 'btn ghost block', html: '⬇️ ייצוא גיבוי',
    onclick: () => {
      const blob = new Blob([S.exportJson()], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'pillapp-backup-' + S.ymd() + '.json';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }
  }));
  c6.appendChild(el('div', { class: 'spacer' }));
  const imp = el('input', { type: 'file', accept: 'application/json', class: 'hidden' });
  imp.addEventListener('change', async () => {
    const f = imp.files[0]; if (!f) return;
    const ok = await confirmBig('הייבוא ידרוס את כל הנתונים הקיימים. להמשיך?', 'לייבא', true);
    if (!ok) return;
    try { S.importJson(await f.text()); toast('יובא בהצלחה', 'ok'); render(); }
    catch (e) { toast('הקובץ לא תקין', 'error'); }
  });
  c6.appendChild(imp);
  c6.appendChild(el('button', { class: 'btn ghost block', html: '⬆️ ייבוא גיבוי', onclick: () => imp.click() }));

  const c7 = card('📜', 'תנאי שימוש');
  const accAt = Legal.acceptedAt();
  c7.appendChild(el('p', {
    class: 'small muted',
    text: accAt
      ? 'אישרת את גרסה ' + Legal.TERMS_VERSION + ' ב־' +
        new Date(accAt).toLocaleString('he-IL', { dateStyle: 'medium', timeStyle: 'short' })
      : 'טרם אושרו.'
  }));
  c7.appendChild(el('button', { class: 'btn ghost block', text: '📜 קריאת התקנון', onclick: () => openLegalReader() }));

  v.appendChild(el('p', { class: 'hint center', text: 'האפליקציה היא עזר לזיכרון בלבד ואינה מחליפה הוראות של רופא או רוקח.' }));
}

function scrollToCard(id) {
  const c = document.getElementById(id);
  if (!c) return;
  c.scrollIntoView({ behavior: 'smooth', block: 'center' });
  c.style.transition = 'box-shadow .3s';
  c.style.boxShadow = '0 0 0 4px var(--info)';
  setTimeout(() => { c.style.boxShadow = ''; }, 1600);
}

// ============================================================
//  תקנון — שער חובה
// ============================================================
function legalHtml() {
  let h = '<div class="legal-intro">היישום הזה הוא <b>עזר לזיכרון בלבד</b>. ' +
    'הוא אינו מכשיר רפואי, אינו תחליף לרופא, לרוקח או לעלון, ואין להסתמך עליו. ' +
    'קראי את התנאים במלואם — אישורם הוא תנאי לשימוש.</div>';
  Legal.SECTIONS.forEach(sec => {
    h += '<h3>' + esc(sec.t) + '</h3>';
    sec.p.forEach(par => {
      h += par.trim().indexOf('<ul>') === 0 ? par : '<p>' + par + '</p>';
    });
  });
  h += '<p class="hint" style="margin-top:22px">גרסת תקנון ' + esc(Legal.TERMS_VERSION) +
    ' · ' + esc(Legal.TERMS_DATE) + '</p>';
  return h;
}

/** מציג את השער. מחזיר Promise שנפתר רק לאחר אישור. */
export function showLegalGate() {
  return new Promise(resolve => {
    const gate = $('#legalGate');
    const body = $('#legalBody');
    const chk = $('#legalCheck');
    const okBtn = $('#legalAccept');
    const noBtn = $('#legalDecline');

    $('#legalMeta').textContent = 'גרסה ' + Legal.TERMS_VERSION + ' · ' + Legal.TERMS_DATE +
      ' · יש לגלול עד הסוף';
    body.innerHTML = legalHtml();
    chk.checked = false;
    okBtn.disabled = true;

    // חייבים גם לגלול עד הסוף וגם לסמן — כדי שהאישור יהיה אמיתי
    let reachedEnd = false;
    const hint = el('div', { class: 'legal-scrollhint', text: '↓ גללי עד סוף המסמך כדי לאשר' });
    $('#legalCheckWrap').before(hint);

    function recheck() {
      okBtn.disabled = !(reachedEnd && chk.checked);
    }
    function onScroll() {
      if (body.scrollTop + body.clientHeight >= body.scrollHeight - 40) {
        reachedEnd = true;
        hint.remove();
        recheck();
      }
    }
    body.addEventListener('scroll', onScroll);
    chk.addEventListener('change', recheck);
    setTimeout(onScroll, 200);   // מסמך קצר ממסך אחד

    okBtn.onclick = () => {
      if (okBtn.disabled) return;
      Legal.accept();
      gate.classList.add('hidden');
      document.body.style.overflow = '';
      body.removeEventListener('scroll', onScroll);
      resolve(true);
    };
    noBtn.onclick = () => {
      body.scrollTop = 0;
      toast('בלי אישור התנאים לא ניתן להשתמש ביישום.', 'error', true);
    };

    gate.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  });
}

/** קריאה חוזרת של התקנון מתוך ההגדרות */
export function openLegalReader() {
  openSheet('תנאי שימוש', () => {
    const wrap = el('div');
    const at = Legal.acceptedAt();
    wrap.appendChild(el('div', {
      class: 'ai-status ok',
      html: at ? '✅ אישרת את גרסה ' + esc(Legal.TERMS_VERSION) + ' בתאריך ' +
        esc(new Date(at).toLocaleString('he-IL', { dateStyle: 'medium', timeStyle: 'short' }))
        : 'טרם אושר'
    }));
    wrap.appendChild(el('div', { class: 'legal-body', style: 'padding:0;max-height:none', html: legalHtml() }));
    return wrap;
  });
}

// ============================================================
//  אישורים — הכול במקום אחד
// ============================================================
export function openPermissions(auto) {
  openSheet('אישורים', () => {
    const wrap = el('div');
    wrap.appendChild(el('p', {
      class: 'small',
      text: 'האפליקציה מבקשת את כל האישורים כאן, פעם אחת. הטלפון ישאל על כל אחד בנפרד — ' +
        'פשוט לאשר. אפשר לוותר על מה שלא רוצים, וההתראות הן היחיד שבאמת חובה.'
    }));

    const listBox = el('div', { class: 'diag', style: 'margin:12px 0' });
    wrap.appendChild(listBox);

    const allBtn = el('button', { class: 'btn block big', html: '✓ אישור הכול' });
    wrap.appendChild(allBtn);

    const note = el('div', { class: 'hint', style: 'margin-top:10px' });
    wrap.appendChild(note);

    const LABEL = { granted: 'מאושר ✓', denied: 'חסום ✗', prompt: 'ממתין', unsupported: 'לא רלוונטי' };

    async function paint() {
      const list = await Perms.snapshot();
      listBox.innerHTML = '';
      list.forEach(x => {
        const row = el('div', { class: 'diag-row' });
        row.appendChild(el('span', {
          class: 'diag-k', style: 'min-width:auto;flex:1',
          html: x.icon + ' <b>' + esc(x.label) + '</b>' + (x.required ? ' <span class="badge danger">חובה</span>' : '') +
            '<br><span class="hint" style="margin:0">' + esc(x.why) + '</span>'
        }));
        if (x.status === 'granted' || x.status === 'unsupported') {
          row.appendChild(el('span', {
            class: 'diag-v ' + (x.status === 'granted' ? 'ok' : ''), style: 'flex:none',
            text: LABEL[x.status]
          }));
        } else {
          row.appendChild(el('button', {
            class: 'btn' + (x.status === 'denied' ? ' ghost' : ''),
            style: 'min-height:44px;padding:8px 14px;flex:none',
            text: x.status === 'denied' ? 'חסום' : 'אישור',
            onclick: async e => {
              if (x.status === 'denied') { showDeniedHelp(x.label); return; }
              const b = e.currentTarget; b.disabled = true; b.innerHTML = '<span class="busy"></span>';
              try { await Perms.get(x.key).request(); }
              catch (err) { note.textContent = '⚠️ ' + err.message; }
              await paint();
              render();
            }
          }));
        }
        listBox.appendChild(row);
      });

      const sum = Perms.summarize(list);
      allBtn.disabled = sum.granted === sum.total;
      allBtn.innerHTML = sum.granted === sum.total
        ? '✅ כל האישורים קיימים'
        : '✓ אישור הכול (' + sum.granted + ' מתוך ' + sum.total + ')';
    }

    allBtn.addEventListener('click', async () => {
      allBtn.disabled = true;
      note.textContent = '';
      const list = await Perms.snapshot();
      const pending = list.filter(x => x.status === 'prompt');
      const failed = [];
      for (const x of pending) {
        try { await Perms.get(x.key).request(); }
        catch (e) { failed.push(x.label + ': ' + e.message); }
        await paint();
      }
      note.innerHTML = failed.length
        ? '⚠️ לא אושרו:<br>' + failed.map(esc).join('<br>')
        : '✅ הכול אושר.';
      render();
      // ההתראות אושרו — אפשר להפעיל מיד את תזכורות השרת
      if (Notification.permission === 'granted' && !S.state.settings.push.enabled) {
        note.innerHTML += '<br>מפעיל את התזכורות…';
        try {
          const r = await Push.enable(S.state.settings.push.server);
          try { await Push.testPush(); } catch (e2) { /* ignore */ }
          note.innerHTML += '<br>✅ התזכורות פועלות (' + r.slots + ' רשומות). שלחתי התראת בדיקה.';
        } catch (e) { note.innerHTML += '<br>⚠️ ' + esc(e.message); }
        render();
      }
    });

    paint();
    if (auto) setTimeout(() => allBtn.click(), 400);
    return wrap;
  });
}

function showDeniedHelp(label) {
  openSheet('לפתוח אישור שנחסם', () => {
    const wrap = el('div');
    wrap.appendChild(el('p', { text: 'האישור ל' + label + ' נחסם בעבר, ולכן הדפדפן כבר לא ישאל שוב. כך פותחים:' }));
    const ol = el('ol', { style: 'padding-inline-start:22px;line-height:2' });
    [
      'לוחצים על סמל המנעול 🔒 (או ⓘ) ליד הכתובת למעלה.',
      'בוחרים "הרשאות" או "Permissions".',
      'מעבירים את ' + label + ' ל"אפשר".',
      'חוזרים לכאן ומרעננים את הדף.'
    ].forEach(t => ol.appendChild(el('li', { text: t })));
    wrap.appendChild(ol);
    wrap.appendChild(el('button', { class: 'btn block', text: 'חזרה לאישורים', onclick: () => openPermissions(false) }));
    return wrap;
  });
}

// ============================================================
//  הדרכה: התקנה למסך הבית
// ============================================================
export function openInstallHelp() {
  openSheet('אייקון במסך הבית', () => {
    const wrap = el('div');

    if (Install.isInstalled()) {
      wrap.appendChild(el('div', { class: 'ai-status ok', html: '<div class="ai-head">✅ כבר מותקנת</div>' +
        '<p class="small">האפליקציה רצה ממסך הבית. האייקון כבר שם.</p>' }));
      return wrap;
    }

    wrap.appendChild(el('p', {
      class: 'small',
      text: 'אחרי ההתקנה יופיע אייקון עגול עם כדור ושעון במסך הבית, בדיוק כמו כל אפליקציה. ' +
        'היא תיפתח במסך מלא בלי סרגלי הדפדפן, והנתונים והתזכורות נשארים בדיוק כמו שהם.'
    }));

    if (Install.canPrompt()) {
      wrap.appendChild(el('button', {
        class: 'btn block big', style: 'margin:14px 0', html: '📲 התקנה עכשיו',
        onclick: async e => {
          e.currentTarget.disabled = true;
          const r = await Install.prompt();
          if (r === 'accepted') { closeSheet(); toast('מתקין… האייקון יופיע במסך הבית.', 'ok', true); }
          else if (r === 'dismissed') { e.currentTarget.disabled = false; toast('ההתקנה בוטלה.', 'warn'); }
          else { e.currentTarget.disabled = false; toast('הדפדפן לא הציע התקנה כרגע — לפי ההוראות למטה.', 'warn', true); }
        }
      }));
      wrap.appendChild(el('p', { class: 'hint', text: 'אם הכפתור לא עובד, אפשר גם ידנית:' }));
    } else {
      wrap.appendChild(el('div', {
        class: 'ai-status warn', style: 'margin:12px 0',
        html: '<p class="small">הדפדפן לא הציע התקנה אוטומטית כרגע. זה קורה אם כבר ביטלת פעם אחת, ' +
          'או בדפדפנים מסוימים. אפשר להתקין ידנית — זה לוקח שתי לחיצות:</p>'
      }));
    }

    const ol = el('ol', { style: 'padding-inline-start:22px;line-height:2' });
    Install.manualSteps().forEach(t => ol.appendChild(el('li', { text: t })));
    wrap.appendChild(ol);

    wrap.appendChild(el('p', {
      class: 'hint',
      text: 'חשוב: להתקין מאותו דפדפן שבו כבר הגדרת את האפליקציה — כל הנתונים והתזכורות עוברים איתה.'
    }));
    return wrap;
  });
}

// ============================================================
//  הדרכה: איך משיגים מפתח Gemini
// ============================================================
export function openGeminiSetup() {
  openSheet('מפתח Gemini — איך משיגים', () => {
    const wrap = el('div');
    wrap.appendChild(el('p', {
      class: 'small',
      text: 'המפתח הוא מה שמאפשר שתי יכולות: לצלם אריזה והאפליקציה תמלא את הפרטים לבד, ' +
        'וכפתור המידע על התרופה. הוא חינם, לוקח דקה, ונשמר רק במכשיר הזה.'
    }));

    const ol = el('ol', { style: 'padding-inline-start:22px;line-height:1.9' });
    [
      'לוחצים על הכפתור הכחול למטה — נפתח האתר של גוגל.',
      'מתחברים עם חשבון הגוגל (אותו חשבון כמו בטלפון).',
      'לוחצים על <b>Create API key</b> (או "צור מפתח API").',
      'מעתיקים את המפתח הארוך שמופיע — מתחיל ב-<span dir="ltr">AIza</span>.',
      'חוזרים לכאן ומדביקים אותו בשדה שלמטה.'
    ].forEach(t => ol.appendChild(el('li', { html: t })));
    wrap.appendChild(ol);

    wrap.appendChild(el('a', {
      class: 'btn block', style: 'margin:14px 0;text-decoration:none',
      href: 'https://aistudio.google.com/apikey', target: '_blank', rel: 'noopener',
      html: '🔗 פתיחת האתר להשגת המפתח'
    }));

    const keyIn = el('input', { type: 'text', placeholder: 'AIza…', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', dir: 'ltr' });
    keyIn.value = S.state.settings.geminiKey || '';
    wrap.appendChild(el('label', { class: 'field' }, [
      el('span', { class: 'lbl', text: 'הדבקת המפתח כאן' }), keyIn
    ]));

    const out = el('div', { class: 'hint', style: 'min-height:1.4em' });
    wrap.appendChild(out);

    wrap.appendChild(el('button', {
      class: 'btn block big', text: '✓ שמירה ובדיקה',
      onclick: async e => {
        const b = e.currentTarget;
        const k = keyIn.value.trim();
        if (!k) { toast('צריך להדביק מפתח', 'error'); return; }
        S.state.settings.geminiKey = k;
        S.save();
        b.disabled = true; b.innerHTML = '<span class="busy"></span> בודק…';
        try {
          await G.testKey();
          out.innerHTML = '✅ המפתח עובד.';
          toast('המפתח נשמר ועובד', 'ok');
          setTimeout(() => { closeSheet(); render(); }, 900);
        } catch (err) {
          out.innerHTML = '⚠️ ' + esc(err.message);
          b.disabled = false; b.textContent = '✓ שמירה ובדיקה';
        }
      }
    }));

    if (S.state.settings.geminiKey) {
      wrap.appendChild(el('div', { class: 'spacer' }));
      wrap.appendChild(el('button', {
        class: 'btn ghost block', text: '🗑 הסרת המפתח',
        onclick: () => { S.state.settings.geminiKey = ''; S.save(); closeSheet(); render(); toast('הוסר', 'ok'); }
      }));
    }
    return wrap;
  });
}

// ============================================================
//  התזכורת הגדולה
// ============================================================
export function openReminder(slot, nagCount) {
  currentReminder = slot;
  const m = slot.med;
  const body = $('#reminderBody');
  const acts = $('#reminderActions');
  body.innerHTML = '';
  acts.innerHTML = '';

  const warn = m.info && m.info.redWarnings && m.info.redWarnings.length ? m.info.redWarnings[0] : null;
  if (warn) body.appendChild(el('div', { class: 'reminder-warn', text: '⚠️ ' + warn }));

  // מנה שאיחרה בהרבה: לא אומרים "קחי עכשיו" אלא "לא סומנה"
  const lateBy = Date.now() - slot.at.getTime();
  const isOld = !slot.status && lateBy > 90 * 60000;
  body.appendChild(el('div', {
    class: 'reminder-kicker',
    text: isOld ? T.lateReminderTitle(m, slot.time, Sch.agoText(lateBy)) : T.reminderTitle(m, slot.id)
  }));

  // שתי התמונות יחד — האריזה מזהה את המוצר, הכדור מזהה מה בדיוק לבלוע.
  // כשיש רק אחת היא מוצגת גדולה.
  const both = m.photoBox && m.photoPill;
  if (both) {
    const pair = el('div', { class: 'reminder-pair' });
    [
      { src: m.photoPill, label: '💊 הכדור' },
      { src: m.photoBox, label: '📦 האריזה' }
    ].forEach(x => {
      const tile = el('div', { class: 'reminder-tile' });
      tile.appendChild(el('img', { src: x.src, alt: x.label }));
      tile.appendChild(el('span', { class: 'reminder-tile-label', text: x.label }));
      pair.appendChild(tile);
    });
    body.appendChild(pair);
  } else {
    const pic = el('div', { class: 'reminder-pic' });
    const mainPh = S.medPhoto(m);
    if (mainPh) pic.appendChild(el('img', { src: mainPh, alt: m.name }));
    else pic.textContent = '💊';
    body.appendChild(pic);
  }

  body.appendChild(el('div', { class: 'reminder-name', text: m.name }));
  body.appendChild(el('div', { class: 'reminder-dose', text: T.doseText(m) + (m.strength ? ' · ' + m.strength : '') }));

  const pd = S.pillDescription(m);
  if (pd) body.appendChild(el('div', { class: 'reminder-pill', text: '💊 ' + pd }));

  const cond = T.conditionText(m);
  if (cond) body.appendChild(el('div', { class: 'reminder-cond', text: cond }));
  body.appendChild(el('div', { class: 'reminder-time', text: 'השעה שנקבעה: ' + slot.time + (slot.dateStr !== S.ymd() ? ' · ' + slot.dateStr : '') }));
  if (m.notes) body.appendChild(el('div', { class: 'small muted', style: 'max-width:34ch', text: m.notes }));

  if (slot.status) {
    body.appendChild(el('div', {
      class: 'badge ' + (slot.status === 'taken' ? 'ok' : ''),
      style: 'font-size:1.1em;padding:8px 20px',
      text: slot.status === 'taken' ? '✓ סומן כנלקח' : 'סומן כדילוג'
    }));
    acts.appendChild(el('button', {
      class: 'btn ghost block big', text: 'ביטול הסימון',
      onclick: () => { S.unmarkSlot(slot.id); closeReminder(); }
    }));
  } else {
    if (isOld) {
      acts.appendChild(el('div', {
        class: 'small muted center', style: 'margin-bottom:2px',
        text: 'עבר זמן. אם לא בטוחה אם לקחת — אל תיקחי מנה כפולה, סמני "לא לקחתי" ובדקי עם הרוקח.'
      }));
    }
    acts.appendChild(el('button', {
      class: 'btn ok block big', html: isOld ? '✓ כן, לקחתי' : '✓ לקחתי',
      onclick: () => {
        S.markSlot(slot.id, 'taken');
        N.clearNag(slot.id);
        N.stopSpeaking();
        N.chime('success');
        closeReminder();
        toast('מצוין. סומן.', 'ok');
      }
    }));

    const snoozeRow = el('div', { class: 'snooze-row' });
    (S.state.settings.snoozeOptions || [5, 10, 20, 60]).forEach(min => {
      snoozeRow.appendChild(el('button', {
        class: 'btn ghost',
        text: min >= 60 ? (min / 60) + ' שע׳' : min + ' דק׳',
        onclick: () => {
          N.snooze(slot.id, min);
          N.stopSpeaking();
          closeReminder();
          toast('נזכיר שוב בעוד ' + (min >= 60 ? (min / 60) + ' שעות' : min + ' דקות'), 'ok');
        }
      }));
    });
    acts.appendChild(el('div', { class: 'lbl small muted center', text: 'נודניק' }));
    acts.appendChild(snoozeRow);

    const row = el('div', { class: 'row' });
    row.appendChild(el('button', {
      class: 'btn ghost grow', html: 'ℹ️ מידע',
      onclick: () => openDrugInfo(m)
    }));
    row.appendChild(el('button', {
      class: 'btn ghost grow', text: isOld ? 'לא לקחתי' : 'דילגתי',
      onclick: async () => {
        const ok = await confirmBig('לסמן שלא לקחת את ' + m.name + '?', 'כן, לא לקחתי');
        if (ok) { S.markSlot(slot.id, 'skipped'); N.clearNag(slot.id); N.stopSpeaking(); closeReminder(); }
      }
    }));
    acts.appendChild(row);
  }

  acts.appendChild(el('button', { class: 'btn ghost block', text: 'סגירה', onclick: closeReminder }));

  $('#reminder').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

export function closeReminder() {
  currentReminder = null;
  $('#reminder').classList.add('hidden');
  document.body.style.overflow = '';
  N.stopSpeaking();
  render();
}

function refreshReminderIfMarked() {
  if (!currentReminder) return;
  const st = S.state.log[currentReminder.id];
  if (st && !currentReminder.status) closeReminder();
}

export function reminderIsOpen() { return !$('#reminder').classList.contains('hidden'); }

// ============================================================
//  פנס
// ============================================================
export async function toggleTorch() {
  const btn = $('#btnTorch');
  try {
    const on = await Tools.toggleTorch();
    btn.classList.toggle('on', on);
    if (on) toast('הפנס דולק', 'ok');
  } catch (e) {
    btn.classList.remove('on');
    toast(e.message, 'error', true);
  }
}

// ============================================================
//  זכוכית מגדלת
// ============================================================
let magFrozen = false;
let magDigital = 1;

export async function openMagnifier() {
  const ov = $('#magnifier');
  const video = $('#magVideo');
  ov.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  magFrozen = false;
  try {
    const caps = await Tools.startMagnifier(video);
    const slider = $('#magZoom');
    slider.min = 1;
    slider.max = caps.hasOpticalZoom ? Math.min(caps.zoomMax, 10) : 8;
    slider.value = caps.hasOpticalZoom ? Math.max(1, caps.zoomMin) : 1;
    magDigital = 1;
    applyZoom(Number(slider.value), caps.hasOpticalZoom);
    slider.oninput = () => applyZoom(Number(slider.value), caps.hasOpticalZoom);
    $('#magTorch').classList.toggle('hidden', !caps.hasTorch);
    $('#magTorch').classList.toggle('on', Tools.torchIsOn());
  } catch (e) {
    closeMagnifier();
    toast(e.message || 'לא הצלחתי לפתוח את המצלמה', 'error', true);
  }
}

function applyZoom(val, optical) {
  const video = $('#magVideo');
  $('#magZoomLabel').textContent = 'הגדלה ×' + val.toFixed(1);
  if (optical) {
    Tools.setZoom(val).then(ok => { if (!ok) video.style.transform = 'scale(' + val + ')'; });
    video.style.transform = '';
  } else {
    video.style.transform = 'scale(' + val + ')';
    video.style.transformOrigin = 'center center';
  }
  magDigital = val;
}

export function closeMagnifier() {
  const video = $('#magVideo');
  Tools.stopMagnifier(video);
  video.style.transform = '';
  $('#magnifier').classList.add('hidden');
  document.body.style.overflow = '';
  $('#btnTorch').classList.toggle('on', Tools.torchIsOn());
}

export function wireMagnifier() {
  $('#magClose').addEventListener('click', closeMagnifier);
  $('#magTorch').addEventListener('click', async e => {
    try {
      const on = await Tools.toggleTorch();
      e.currentTarget.classList.toggle('on', on);
    } catch (err) { toast(err.message, 'error'); }
  });
  $('#magFreeze').addEventListener('click', e => {
    const video = $('#magVideo');
    magFrozen = !magFrozen;
    if (magFrozen) { video.pause(); e.currentTarget.classList.add('on'); e.currentTarget.textContent = '▶ המשך'; }
    else { video.play(); e.currentTarget.classList.remove('on'); e.currentTarget.textContent = '⏸ הקפאה'; }
  });
}

// ============================================================
//  מסך שבת
// ============================================================
let shabTimer = null;

export function openShabbat() {
  $('#shabbat').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  N.keepAwake(true);
  paintShabbat();
  shabTimer = setInterval(paintShabbat, 20000);
}

export function closeShabbat() {
  $('#shabbat').classList.add('hidden');
  document.body.style.overflow = '';
  clearInterval(shabTimer); shabTimer = null;
  N.keepAwake(false);
}

function paintShabbat() {
  const now = new Date();
  $('#shabClock').textContent = S.hm(now);
  $('#shabDate').textContent = now.toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long' });
  const list = $('#shabList');
  list.innerHTML = '';
  const slots = Sch.slotsForDate(S.ymd(now));
  if (!slots.length) {
    list.appendChild(el('div', { class: 'empty' }, [el('div', { class: 'big', text: '🕯️' }), el('p', { text: 'אין תרופות היום.' })]));
    return;
  }
  slots.forEach(s => {
    const item = el('div', { class: 'shab-item' + (s.status ? ' done' : '') });
    const pic = el('div', { class: 'pic' });
    const ph = S.medPhoto(s.med);
    if (ph) pic.appendChild(el('img', { src: ph, alt: '' }));
    else pic.textContent = '💊';
    item.appendChild(pic);
    item.appendChild(el('div', {}, [
      el('div', { class: 'nm', text: s.med.name }),
      el('div', { class: 'ds', text: T.doseText(s.med) }),
      T.conditionText(s.med) ? el('div', { class: 'small', text: T.conditionText(s.med) }) : null
    ]));
    item.appendChild(el('div', { class: 'tm', text: s.status === 'taken' ? '✓' : s.time }));
    list.appendChild(item);
  });
}
