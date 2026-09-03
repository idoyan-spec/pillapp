// ============================================================
//  nav.js  —  כפתור "חזור" של אנדרואיד
//  בלי זה, לחיצה על חזור סוגרת את האפליקציה במקום לסגור חלון.
//
//  השיטה: מחזיקים ערך היסטוריה אחד "מלכודת" עם סימן משלנו. כל לחיצת
//  חזור נקלטת, סוגרת את השכבה הפתוחה, והמלכודת נדרכת מחדש.
//  אין ניהול מחסנית — בודקים מה פתוח ב-DOM, ולכן כל דרך סגירה אחרת
//  (כפתור ✕, לחיצה מחוץ לחלון, Escape) נשארת עקבית.
//
//  הגרסה הקודמת נשברה בשקט: אם משהו זרק בתוך הטיפול, המלכודת לא
//  נדרכה מחדש והלחיצה הבאה סגרה את האפליקציה. כאן הכול עטוף,
//  והדריכה נבדקת מחדש בכל חזרה למסך ובכל נגיעה.
// ============================================================
const MARK = 'pillapp-trap';

let handlers = null;
let lastExitHint = 0;
let started = false;

export function isArmed() {
  try { return !!(history.state && history.state[MARK]); } catch (e) { return false; }
}

export function armCount() { return armed; }
let armed = 0;

function arm(force) {
  try {
    if (!force && isArmed()) return;
    const st = {}; st[MARK] = Date.now();
    history.pushState(st, '');
    armed++;
  } catch (e) { /* ignore */ }
}

/**
 * @param {{closeTop:()=>boolean, atRoot:()=>boolean, goRoot:()=>void, onExitHint:()=>void}} h
 */
export function init(h) {
  if (started) return;
  handlers = h;
  started = true;

  arm(true);
  window.addEventListener('popstate', onPop);

  // דריכה מחדש אם ההיסטוריה אופסה (טעינה מחדש של SW, ניווט חיצוני,
  // או חזרה לאפליקציה אחרי שמערכת ההפעלה שחררה אותה)
  document.addEventListener('visibilitychange', () => { if (!document.hidden) arm(); });
  window.addEventListener('pageshow', () => arm());
  window.addEventListener('focus', () => arm());
  document.addEventListener('pointerdown', () => arm(), { passive: true, capture: true });
}

function onPop() {
  if (!handlers) return;
  let consumed = false;

  try { consumed = !!handlers.closeTop(); } catch (e) { console.warn('[nav] closeTop', e); }
  if (consumed) { arm(true); return; }

  try {
    if (!handlers.atRoot()) { handlers.goRoot(); arm(true); return; }
  } catch (e) { console.warn('[nav] atRoot', e); }

  // במסך הראשי בלי שום דבר פתוח — לחיצה שנייה תצא באמת
  const now = Date.now();
  if (now - lastExitHint < 2500) return;   // לא דורכים מחדש → יציאה
  lastExitHint = now;
  try { handlers.onExitHint(); } catch (e) { /* ignore */ }
  arm(true);
}

/** לצורכי אבחון בהגדרות */
export function debug() {
  return {
    started: started,
    armed: isArmed(),
    arms: armed,
    historyLength: (typeof history !== 'undefined' && history.length) || 0
  };
}
