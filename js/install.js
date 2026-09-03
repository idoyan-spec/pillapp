// ============================================================
//  install.js  —  התקנה למסך הבית
//  אנדרואיד מציע התקנה דרך אירוע beforeinstallprompt. שומרים אותו
//  וקוראים לו מכפתור, במקום להשאיר את המשתמש/ת לחפש בתפריט הדפדפן.
// ============================================================
let deferred = null;

export function isInstalled() {
  return window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true ||
    document.referrer.indexOf('android-app://') === 0;
}

export function canPrompt() { return !!deferred; }

export function init() {
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferred = e;
    document.dispatchEvent(new CustomEvent('pill:installable'));
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    document.dispatchEvent(new CustomEvent('pill:installed'));
  });
}

/** @returns {'accepted'|'dismissed'|'unavailable'} */
export async function prompt() {
  if (!deferred) return 'unavailable';
  deferred.prompt();
  let outcome = 'dismissed';
  try { const r = await deferred.userChoice; outcome = r.outcome; } catch (e) { /* ignore */ }
  deferred = null;
  return outcome;
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
