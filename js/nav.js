// ============================================================
//  nav.js  —  כפתור "חזור" של אנדרואיד
//  בלי זה, לחיצה על חזור סוגרת את האפליקציה במקום לסגור חלון.
//
//  השיטה: מחזיקים ערך היסטוריה אחד "מלכודת". כל לחיצת חזור נקלטת,
//  סוגרת את השכבה העליונה שפתוחה כרגע, ואז המלכודת נדרכת מחדש.
//  אין ניהול מחסנית — פשוט בודקים מה פתוח ב-DOM, ולכן כל דרך סגירה
//  אחרת (כפתור ✕, לחיצה מחוץ לחלון, Escape) נשארת עקבית.
// ============================================================
let handlers = null;
let lastExitHint = 0;
let started = false;

/**
 * @param {{closeTop:()=>boolean, atRoot:()=>boolean, goRoot:()=>void, onExitHint:()=>void}} h
 */
export function init(h) {
  if (started) return;
  handlers = h;
  started = true;
  arm();
  window.addEventListener('popstate', onPop);
}

function arm() {
  try { history.pushState({ pill: Date.now() }, ''); } catch (e) { /* ignore */ }
}

function onPop() {
  if (!handlers) return;

  // 1. שכבה פתוחה — סוגרים אותה
  if (handlers.closeTop()) { arm(); return; }

  // 2. לא במסך הראשי — חוזרים אליו
  if (!handlers.atRoot()) { handlers.goRoot(); arm(); return; }

  // 3. במסך הראשי בלי שום דבר פתוח — לחיצה שנייה תצא באמת
  const now = Date.now();
  if (now - lastExitHint < 2500) return;   // לא דורכים מחדש → יציאה
  lastExitHint = now;
  handlers.onExitHint();
  arm();
}
