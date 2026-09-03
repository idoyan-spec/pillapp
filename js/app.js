// ============================================================
//  app.js  —  אתחול וחיווט
// ============================================================
import * as S from './store.js';
import * as UI from './ui.js';
import * as N from './notify.js';
import * as Sensors from './sensors.js';
import * as Sch from './schedule.js';
import * as Push from './push.js';
import * as Mirror from './mirror.js';
import * as Install from './install.js';
import * as Nav from './nav.js';
import { $, el, toast, openSheet, closeSheet } from './dom.js';
import { openMedEditor } from './editors.js';

S.load();
console.log('%c pillApp ' + S.BUILD, 'background:#0f6f5c;color:#fff;padding:2px 8px;border-radius:4px');

// ---------- Service Worker ----------
let swReg = null;
async function registerSW() {
  if (!('serviceWorker' in navigator)) return null;
  try {
    // updateViaCache:'none' — sw.js עצמו נמשך תמיד מהרשת, אחרת עדכון עלול לא להתגלה
    swReg = await navigator.serviceWorker.register('sw.js', { scope: './', updateViaCache: 'none' });

    // כשגרסה חדשה נכנסת לתוקף — טעינה מחדש פעם אחת, כדי שלא ירוץ קוד מעורבב
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloaded) return;
      reloaded = true;
      location.reload();
    });

    await navigator.serviceWorker.ready;
    swReg.update().catch(() => { });
    return swReg;
  } catch (e) {
    console.warn('[pillApp] SW לא נרשם:', e.message);
    return null;
  }
}

// ---------- חיווט ממשק ----------
function wire() {
  Array.prototype.forEach.call($('#tabbar').children, b => {
    b.addEventListener('click', () => { N.primeMedia(); UI.showView(b.getAttribute('data-view')); });
  });

  $('#btnTorch').addEventListener('click', () => { N.primeMedia(); UI.toggleTorch(); });
  $('#btnMag').addEventListener('click', () => { N.primeMedia(); UI.openMagnifier(); });
  $('#sheetClose').addEventListener('click', closeSheet);
  $('#sheet').addEventListener('click', e => { if (e.target.id === 'sheet') closeSheet(); });
  $('#shabClose').addEventListener('click', UI.closeShabbat);
  UI.wireMagnifier();

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeTopLayer();
  });

  // כפתור "חזור" של אנדרואיד — סוגר שכבה, ואז חוזר למסך הראשי,
  // ורק בלחיצה שנייה במסך הראשי באמת יוצא.
  Nav.init({
    closeTop: closeTopLayer,
    atRoot: () => UI.currentView() === 'today',
    goRoot: () => UI.showView('today'),
    onExitHint: () => toast('לחצי שוב על "חזור" כדי לצאת', 'info')
  });

  // תזכורת פנימית
  document.addEventListener('pill:reminder', e => {
    if (!$('#magnifier').classList.contains('hidden')) return;
    if (!$('#shabbat').classList.contains('hidden')) return;
    UI.openReminder(e.detail.slot, e.detail.nagCount);
  });

  // פעולה מתוך התראת מערכת
  document.addEventListener('pill:swaction', e => {
    const d = e.detail;
    if (d.action === 'taken' && d.slotId) {
      S.markSlot(d.slotId, 'taken');
      N.chime('success');
      toast('סומן ✓', 'ok');
    } else if (d.action === 'snooze' && d.slotId) {
      N.snooze(d.slotId, 10);
      toast('נזכיר שוב בעוד 10 דקות', 'ok');
    } else if (d.slotId) {
      const parts = d.slotId.split('|');
      const slots = Sch.slotsForDate(parts[1]);
      const slot = slots.find(s => s.id === d.slotId);
      if (slot) UI.openReminder(slot, 0);
    }
    UI.render();
  });

  document.addEventListener('pill:quietannounce', () => {
    if ($('#shabbat').classList.contains('hidden') && S.state.settings.quiet.showBoard) UI.openShabbat();
  });

  // מנה סומנה — לומר לשרת שיפסיק לנדנד עליה
  document.addEventListener('pill:marked', e => {
    if (!S.state.settings.push.enabled) return;
    Push.ack([Push.serverKeyOf(e.detail.slotId)]);
  });

  // רענון תצוגה בכל שינוי נתונים ובכל טיק
  S.subscribe(() => UI.render());
  document.addEventListener('pill:tick', () => {
    if ($('#shabbat').classList.contains('hidden')) UI.render();
  });

  // חזרה למסך אחרי שהיה ברקע — בדיקה מיידית של החמצות
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) { N.tick(); UI.render(); }
  });
}

/** סוגר את השכבה העליונה שפתוחה. מחזיר true אם היה מה לסגור. */
function closeTopLayer() {
  // סדר לפי שכבות z — העליונה נסגרת ראשונה
  const modal = document.querySelectorAll('.sheet');
  if (modal.length > 1) { modal[modal.length - 1].remove(); return true; }
  if (!$('#magnifier').classList.contains('hidden')) { UI.closeMagnifier(); return true; }
  if (!$('#reminder').classList.contains('hidden')) { UI.closeReminder(); return true; }
  if (!$('#sheet').classList.contains('hidden')) { closeSheet(); return true; }
  if (!$('#shabbat').classList.contains('hidden')) { UI.closeShabbat(); return true; }
  return false;
}

// ---------- ברוכה הבאה ----------
function firstRun() {
  openSheet('ברוכים הבאים', () => {
    const wrap = el('div');
    wrap.appendChild(el('p', { text: 'שתי שאלות קצרות, וסיימנו.', class: 'muted' }));

    const nameIn = el('input', { type: 'text', placeholder: 'למשל: יהודית' });
    wrap.appendChild(el('label', { class: 'field' }, [
      el('span', { class: 'lbl', text: 'איך לקרוא לך?' }), nameIn,
      el('div', { class: 'hint', text: 'האפליקציה תפנה אלייך בשם הזה בכל תזכורת.' })
    ]));

    let gender = 'f';
    const gRow = el('div', { class: 'chips', style: 'margin-bottom:18px' });
    [{ v: 'f', l: 'לשון נקבה' }, { v: 'm', l: 'לשון זכר' }].forEach(o => {
      gRow.appendChild(el('button', {
        class: 'chip' + (o.v === 'f' ? ' on' : ''), text: o.l,
        onclick: e => {
          gender = o.v;
          Array.prototype.forEach.call(gRow.children, c => c.classList.remove('on'));
          e.currentTarget.classList.add('on');
        }
      }));
    });
    wrap.appendChild(el('div', { class: 'lbl', text: 'איך לפנות אלייך', style: 'font-weight:700;margin-bottom:6px' }));
    wrap.appendChild(gRow);

    wrap.appendChild(el('button', {
      class: 'btn block big', text: 'ממשיכים',
      onclick: async () => {
        S.state.settings.userName = nameIn.value.trim();
        S.state.settings.gender = gender;
        S.saveNow();
        N.primeMedia();
        const p = await N.requestPermission();
        closeSheet();
        UI.render();
        if (p !== 'granted') toast('בלי אישור התראות אפשר לראות תזכורות רק כשהאפליקציה פתוחה.', 'warn', true);
        setTimeout(() => {
          if (!S.state.meds.length) openMedEditor(null);
        }, 500);
      }
    }));
    return wrap;
  });
}

// ---------- הפעלה ----------
(async function boot() {
  wire();
  N.capturePreviousRun();          // לפני שהדופק הראשון דורס את הערך
  UI.showView('today');
  const reg = await registerSW();
  await N.init(reg);
  try { await Sensors.applySettings(); } catch (e) { /* ignore */ }

  const st = S.state.settings;
  const today = S.ymd();
  const firstToday = st.lastOpened !== today;
  st.lastOpened = today;
  S.save();

  if (!st.userName && !S.state.meds.length) {
    setTimeout(firstRun, 400);
  } else if (firstToday && Sch.isQuietDate(today) && st.quiet.showBoard) {
    setTimeout(UI.openShabbat, 600);
  } else if (!Sch.isQuietDate(today)) {
    // "לא ירפה" — בפתיחה, מתעמתים מיד עם המנה הכי ותיקה שלא סומנה,
    // בלי תלות בכמה זמן עבר. זה מה שסוגר את הפער כשהאפליקציה הייתה סגורה.
    // רק מנה מה-12 שעות האחרונות. על מנה מלפני יומיים אין טעם לקפוץ —
    // אי אפשר לקחת אותה, והיא מופיעה ממילא בכרטיס "לא סומנו".
    const missed = Sch.unmarkedSlots().filter(s => s.lateMs <= 12 * 3600000);
    if (missed.length) {
      setTimeout(() => {
        if ($('#sheet').classList.contains('hidden') && $('#reminder').classList.contains('hidden')) {
          N.primeMedia();
          UI.openReminder(missed[0], 1);
        }
      }, 700);
    }
  }

  // סימונים שנעשו מתוך ההתראה כשהאפליקציה היתה סגורה
  try {
    const merged = await Mirror.mergeBack(S.state);
    if (merged) { S.save(); toast('נקלטו ' + merged + ' סימונים מההתראות', 'ok'); }
  } catch (e) { /* ignore */ }

  // סנכרון לוח המנות לשרת התזכורות
  // הריפוי חייב לרוץ ראשון ובאופן עצמאי. בגרסה קודמת הוא היה תלוי
  // בהצלחת sync() ובדגל enabled — וכששניהם נפלו, המנוי נשאר מת לנצח.
  if (st.push.server && (st.push.id || st.push.enabled)) {
    Push.heal()
      .then(res => {
        if (res.healed) toast('חידשתי את החיבור לתזכורות ✓', 'ok', true);
        else if (res.problem) toast('התזכורות מנותקות: ' + res.problem, 'error', true);
        UI.render();
      })
      .catch(e => console.warn('[pillApp] ריפוי דחיפות:', e.message));
  }
  Mirror.write(S.state);

  // ניקוי מצב נדנוד ישן
  const cutoff = Date.now() - 3 * 86400000;
  Object.keys(S.state.runtime.nag).forEach(k => {
    const n = S.state.runtime.nag[k];
    if ((n.lastAlertAt || 0) < cutoff) delete S.state.runtime.nag[k];
  });
  Object.keys(S.state.runtime.quietSpoken).forEach(d => {
    if (d < S.ymd(S.addDays(new Date(), -3))) delete S.state.runtime.quietSpoken[d];
  });
  S.save();
})();

// ---------- התקנה ----------
Install.init();
document.addEventListener('pill:installable', () => UI.render());
document.addEventListener('pill:installed', () => { UI.render(); toast('הותקן! האייקון נמצא במסך הבית.', 'ok', true); });

window.pillApp = { S: S, UI: UI, N: N, Sensors: Sensors, Sch: Sch, Push: Push, Mirror: Mirror, Install: Install, BUILD: S.BUILD };
