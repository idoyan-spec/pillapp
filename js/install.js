// ============================================================
//  install.js  —  התקנה למסך הבית
//  אנדרואיד מציע התקנה דרך אירוע beforeinstallprompt. שומרים אותו
//  וקוראים לו מכפתור, במקום להשאיר את המשתמש/ת לחפש בתפריט הדפדפן.
//
//  הרוב המכריע של המשתמשים לא מוצא את "הוספה למסך הבית" בתפריט
//  הדפדפן, ולכן ההצעה כאן *נדחפת מעצמה*: ברגע שהדפדפן מאפשר,
//  היא עולה בלחיצה הבאה על המסך — בלי שצריך לחפש אותה בהגדרות.
//  הדפדפן מחייב מחווה של המשתמש כדי להציג את חלון ההתקנה, ולכן
//  אי אפשר להתקין ממש "בלי לגעת"; מה שכן אפשר הוא שההצעה תמצא
//  את המשתמש/ת ולא להפך.
// ============================================================
import { state, save, ymd } from './store.js';

let deferred = null;
let armed = false;
let guard = null;      // מונע התנגשות עם דיאלוג הרשאות פתוח

export function isInstalled() {
  return window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true ||
    document.referrer.indexOf('android-app://') === 0;
}

export function canPrompt() { return !!deferred; }

function cfg() {
  if (!state.settings.install) {
    state.settings.install = { asked: 0, lastAsk: '', dismissed: false, done: false };
  }
  return state.settings.install;
}

export function init() {
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferred = e;
    document.dispatchEvent(new CustomEvent('pill:installable'));
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    const c = cfg(); c.done = true; save();
    document.dispatchEvent(new CustomEvent('pill:installed'));
  });
}

/** @returns {'accepted'|'dismissed'|'unavailable'} */
export async function prompt() {
  if (!deferred) return 'unavailable';
  const c = cfg();
  c.asked += 1;
  c.lastAsk = ymd();
  save();
  let outcome = 'dismissed';
  try {
    deferred.prompt();
    const r = await deferred.userChoice;
    outcome = r.outcome;
  } catch (e) { outcome = 'unavailable'; }
  deferred = null;
  if (outcome === 'accepted') { c.done = true; save(); }
  return outcome;
}

/** האם מותר להציע מעצמנו עכשיו */
export function shouldOffer() {
  if (isInstalled()) return false;
  const c = cfg();
  if (c.dismissed) return false;
  if (c.asked >= 3) return false;
  if (c.lastAsk === ymd()) return false;
  return true;
}

/** "אל תציעו לי שוב" — נשאר כפתור בהגדרות להתקנה ידנית */
export function stopOffering() {
  const c = cfg();
  c.dismissed = true;
  save();
}

/**
 * דוחף את חלון ההתקנה של הדפדפן בלחיצה הבאה על המסך.
 * הדפדפן דורש מחווה חיה, ולכן לא ניתן לקרוא ל-prompt() מתוך boot().
 * במקום זה נתלים על המגע הבא — שממילא יקרה תוך שניות.
 */
export function setGuard(fn) { guard = fn; }

export function autoOffer() {
  if (armed || !shouldOffer()) return;
  armed = true;

  const fire = () => {
    // דיאלוג הרשאות פתוח? לא דוחפים חלון התקנה על גביו — נחכה למגע הבא.
    if (guard && !guard()) return;
    document.removeEventListener('pointerdown', fire, true);
    document.removeEventListener('keydown', fire, true);
    armed = false;
    if (!deferred || !shouldOffer()) return;
    prompt().then(r => {
      document.dispatchEvent(new CustomEvent('pill:installresult', { detail: { outcome: r } }));
    });
  };

  const arm = () => {
    document.addEventListener('pointerdown', fire, true);
    document.addEventListener('keydown', fire, true);
  };

  if (deferred) arm();
  else document.addEventListener('pill:installable', arm, { once: true });
}

/** הוראות ידניות לפי הדפדפן, למקרה שאין הצעת התקנה אוטומטית */
export function manualSteps() {
  const ua = navigator.userAgent;
  const isIOS = /iPad|iPhone|iPod/.test(ua);
  const isFirefox = /Firefox/.test(ua);
  const isSamsung = /SamsungBrowser/.test(ua);

  if (isIOS) {
    return ['בסרגל התחתון לוחצים על כפתור השיתוף (ריבוע עם חץ למעלה).',
      'גוללים ובוחרים "הוספה למסך הבית".',
      'לוחצים "הוסף" בפינה הימנית העליונה.'];
  }
  if (isSamsung) {
    return ['לוחצים על שלוש השורות בפינה הימנית התחתונה.',
      'בוחרים "הוספת דף אל" ואז "מסך הבית".'];
  }
  if (isFirefox) {
    return ['לוחצים על שלוש הנקודות בפינה.', 'בוחרים "התקנה" או "הוספה למסך הבית".'];
  }
  return ['לוחצים על שלוש הנקודות ⋮ בפינה הימנית העליונה של הדפדפן.',
    'בוחרים "התקנת אפליקציה" או "הוספה למסך הבית".',
    'מאשרים "התקנה".'];
}

/** האם המכשיר דורש התקנה ידנית לחלוטין (iOS) */
export function needsManual() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) && !isInstalled();
}
