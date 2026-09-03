// ============================================================
//  perms.js  —  כל האישורים במקום אחד
//  קודם כל הרשאה נתבקשה במקום אחר ובזמן אחר, ולכן חלקן נשארו
//  לא מאושרות בלי שאיש שם לב. כאן מבקשים את כולן מראש.
// ============================================================
import { state, save } from './store.js';

const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);

/** האם החיישן דורש אישור מפורש (iOS בלבד) */
function motionNeedsPermission() {
  return typeof DeviceMotionEvent !== 'undefined' &&
    typeof DeviceMotionEvent.requestPermission === 'function';
}

async function queryPermission(name) {
  if (!navigator.permissions || !navigator.permissions.query) return null;
  try { const r = await navigator.permissions.query({ name: name }); return r.state; }
  catch (e) { return null; }
}

export const ITEMS = [
  {
    key: 'notifications',
    icon: '🔔',
    label: 'התראות',
    why: 'בלי זה לא תוצג שום תזכורת. זה האישור החשוב ביותר.',
    required: true,
    async status() {
      if (!('Notification' in window)) return 'unsupported';
      return Notification.permission === 'granted' ? 'granted'
        : Notification.permission === 'denied' ? 'denied' : 'prompt';
    },
    async request() {
      if (!('Notification' in window)) throw new Error('הדפדפן לא תומך בהתראות.');
      const p = await Notification.requestPermission();
      if (p !== 'granted') throw new Error(p === 'denied'
        ? 'ההתראות חסומות. צריך לפתוח אותן בהגדרות האתר בדפדפן.'
        : 'האישור לא ניתן.');
      return true;
    }
  },
  {
    key: 'camera',
    icon: '📷',
    label: 'מצלמה',
    why: 'לצילום אריזה וכדור, ולפנס ולזכוכית המגדלת.',
    required: false,
    async status() {
      if (!navigator.mediaDevices) return 'unsupported';
      const s = await queryPermission('camera');
      return s || 'prompt';
    },
    async request() {
      if (!navigator.mediaDevices) throw new Error('אין גישה למצלמה בדפדפן הזה.');
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } }, audio: false
      });
      // רק כדי לקבל את האישור — מכבים מיד
      stream.getTracks().forEach(t => t.stop());
      return true;
    }
  },
  {
    key: 'location',
    icon: '📍',
    label: 'מיקום',
    why: 'לתזכורת "אל תשכחי לקחת" כשיוצאים מהבית. אפשר לוותר.',
    required: false,
    async status() {
      if (!navigator.geolocation) return 'unsupported';
      const s = await queryPermission('geolocation');
      return s || 'prompt';
    },
    async request() {
      if (!navigator.geolocation) throw new Error('אין שירותי מיקום בדפדפן הזה.');
      await new Promise((res, rej) => {
        navigator.geolocation.getCurrentPosition(
          () => res(true),
          e => rej(new Error(e.code === 1 ? 'הגישה למיקום נדחתה.' : 'לא הצלחתי לאתר מיקום.')),
          { enableHighAccuracy: false, timeout: 20000, maximumAge: 600000 }
        );
      });
      return true;
    }
  },
  {
    key: 'motion',
    icon: '📳',
    label: 'חיישן תנועה',
    why: 'לזיהוי השכמה בבוקר. אפשר לוותר.',
    required: false,
    async status() {
      if (typeof DeviceMotionEvent === 'undefined') return 'unsupported';
      if (!motionNeedsPermission()) return 'granted';   // אנדרואיד — לא נדרש אישור
      return state.settings.permsMotion || 'prompt';
    },
    async request() {
      if (typeof DeviceMotionEvent === 'undefined') throw new Error('אין חיישן תנועה במכשיר הזה.');
      if (!motionNeedsPermission()) return true;
      const p = await DeviceMotionEvent.requestPermission();
      state.settings.permsMotion = p; save();
      if (p !== 'granted') throw new Error('האישור לחיישן התנועה לא ניתן.');
      return true;
    }
  }
];

export async function snapshot() {
  const out = [];
  for (const it of ITEMS) {
    let st = 'prompt';
    try { st = await it.status(); } catch (e) { st = 'prompt'; }
    out.push({ key: it.key, icon: it.icon, label: it.label, why: it.why, required: it.required, status: st });
  }
  return out;
}

export function get(key) { return ITEMS.find(i => i.key === key); }

/** כמה מאושרות מתוך כמה שרלוונטיות */
export function summarize(list) {
  const relevant = list.filter(x => x.status !== 'unsupported');
  const granted = relevant.filter(x => x.status === 'granted');
  const missingRequired = relevant.filter(x => x.required && x.status !== 'granted');
  return { total: relevant.length, granted: granted.length, missingRequired: missingRequired.length };
}
