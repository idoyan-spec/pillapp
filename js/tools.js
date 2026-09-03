// ============================================================
//  tools.js  —  פנס + זכוכית מגדלת (חולקים מצלמה אחת, פועלים במקביל)
// ============================================================
let stream = null;
let track = null;
let torchOn = false;
let users = 0;           // כמה תכונות משתמשות במצלמה כרגע (פנס / זכוכית)

export function torchIsOn() { return torchOn; }

async function acquire() {
  if (stream && track && track.readyState === 'live') { users++; return track; }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new Error('הדפדפן הזה לא נותן גישה למצלמה.');
  }
  stream = await navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: { ideal: 'environment' },
      width: { ideal: 1920 },
      height: { ideal: 1080 }
    },
    audio: false
  });
  track = stream.getVideoTracks()[0];
  users++;
  return track;
}

function release() {
  users = Math.max(0, users - 1);
  if (users === 0 && stream) {
    torchOn = false;
    stream.getTracks().forEach(t => t.stop());
    stream = null; track = null;
  }
}

export function capabilities() {
  if (!track || !track.getCapabilities) return {};
  try { return track.getCapabilities() || {}; } catch (e) { return {}; }
}

// ---------- פנס ----------
export async function toggleTorch() {
  if (torchOn) {
    try { await track.applyConstraints({ advanced: [{ torch: false }] }); } catch (e) { /* ignore */ }
    torchOn = false;
    release();
    return false;
  }
  const t = await acquire();
  const caps = (t.getCapabilities && t.getCapabilities()) || {};
  if (!('torch' in caps)) {
    release();
    throw new Error('אין פנס במצלמה הזאת. במחשב אין פנס — נסי בטלפון.');
  }
  await t.applyConstraints({ advanced: [{ torch: true }] });
  torchOn = true;
  return true;
}

export async function torchOff() {
  if (!torchOn) return;
  try { await track.applyConstraints({ advanced: [{ torch: false }] }); } catch (e) { /* ignore */ }
  torchOn = false;
  release();
}

// ---------- זכוכית מגדלת ----------
export async function startMagnifier(videoEl) {
  const t = await acquire();
  videoEl.srcObject = stream;
  videoEl.setAttribute('playsinline', '');
  videoEl.muted = true;
  await videoEl.play().catch(() => { });
  const caps = (t.getCapabilities && t.getCapabilities()) || {};
  return {
    hasOpticalZoom: 'zoom' in caps,
    zoomMin: caps.zoom ? caps.zoom.min : 1,
    zoomMax: caps.zoom ? caps.zoom.max : 1,
    hasTorch: 'torch' in caps
  };
}

export async function setZoom(value) {
  if (!track) return false;
  const caps = (track.getCapabilities && track.getCapabilities()) || {};
  if (!('zoom' in caps)) return false;
  const v = Math.max(caps.zoom.min, Math.min(caps.zoom.max, value));
  try { await track.applyConstraints({ advanced: [{ zoom: v }] }); return true; } catch (e) { return false; }
}

export function stopMagnifier(videoEl) {
  if (videoEl) { try { videoEl.pause(); videoEl.srcObject = null; } catch (e) { /* ignore */ } }
  release();
}

// ---------- צילום תמונה מהמצלמה ----------
export async function capturePhoto(videoEl, maxSize) {
  maxSize = maxSize || 900;
  const w = videoEl.videoWidth, h = videoEl.videoHeight;
  if (!w || !h) throw new Error('המצלמה עדיין לא מוכנה.');
  const scale = Math.min(1, maxSize / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.round(w * scale);
  c.height = Math.round(h * scale);
  c.getContext('2d').drawImage(videoEl, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.85);
}

/**
 * חותך תמונה לפי מלבן יחסי (0..1), עם שוליים קטנים כדי לא לגזוז את הקצה.
 * מרובע-משהו כדי שייראה טוב באריח התזכורת.
 * @param {string} dataUrl
 * @param {{x:number,y:number,w:number,h:number}} box
 */
export function cropToBox(dataUrl, box, pad, maxSize) {
  pad = pad === undefined ? 0.04 : pad;
  maxSize = maxSize || 900;
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onerror = () => reject(new Error('לא הצלחתי לפתוח את התמונה לחיתוך.'));
    img.onload = () => {
      const W = img.width, H = img.height;
      let x = (box.x - pad) * W;
      let y = (box.y - pad) * H;
      let w = (box.w + pad * 2) * W;
      let h = (box.h + pad * 2) * H;

      // ריבוע-כמעט: מרחיבים את הצלע הקצרה כדי שהאריח לא ייראה מעוך
      const side = Math.max(w, h);
      const target = Math.min(side * 1.02, Math.min(W, H));
      const cx = x + w / 2, cy = y + h / 2;
      x = cx - target / 2; y = cy - target / 2; w = h = target;

      x = Math.max(0, Math.min(W - w, x));
      y = Math.max(0, Math.min(H - h, y));
      w = Math.min(w, W - x); h = Math.min(h, H - y);
      if (w < 20 || h < 20) return reject(new Error('אזור החיתוך קטן מדי.'));

      const scale = Math.min(1, maxSize / Math.max(w, h));
      const c = document.createElement('canvas');
      c.width = Math.round(w * scale);
      c.height = Math.round(h * scale);
      c.getContext('2d').drawImage(img, x, y, w, h, 0, 0, c.width, c.height);
      resolve(c.toDataURL('image/jpeg', 0.88));
    };
    img.src = dataUrl;
  });
}

// ---------- דחיסת תמונה מקובץ ----------
export function fileToDataUrl(file, maxSize) {
  maxSize = maxSize || 900;
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('לא הצלחתי לקרוא את הקובץ.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('הקובץ אינו תמונה תקינה.'));
      img.onload = () => {
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * scale);
        c.height = Math.round(img.height * scale);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL('image/jpeg', 0.85));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}
