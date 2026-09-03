// ============================================================
//  webpush.js — שליחת Web Push (RFC 8291 aes128gcm + VAPID RFC 8292)
//  משתמש ב-Web Crypto בלבד, ולכן רץ גם ב-Cloudflare Worker וגם ב-Node.
// ============================================================

const enc = new TextEncoder();

export function b64urlToBytes(s) {
  s = String(s).replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToB64url(bytes) {
  let bin = '';
  const b = new Uint8Array(bytes);
  for (let i = 0; i < b.length; i++) bin += String.fromCharCode(b[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function concat() {
  const parts = Array.prototype.slice.call(arguments).map(x => new Uint8Array(x));
  const len = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

// ------------------------------------------------------------
//  VAPID
// ------------------------------------------------------------

/** מייצר זוג מפתחות VAPID. מריצים פעם אחת ושומרים. */
export async function generateVapidKeys() {
  const kp = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']
  );
  const pub = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
  const jwk = await crypto.subtle.exportKey('jwk', kp.privateKey);
  return {
    publicKey: bytesToB64url(pub),                 // נכנס ללקוח
    privateJwk: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, d: jwk.d }
  };
}

async function importVapidPrivate(privateJwk) {
  return crypto.subtle.importKey(
    'jwk',
    Object.assign({ key_ops: ['sign'], ext: true }, privateJwk),
    { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']
  );
}

/** JWT חתום ES256 עבור כותרת Authorization */
async function vapidJwt(audience, subject, privateJwk) {
  const header = { typ: 'JWT', alg: 'ES256' };
  const payload = {
    aud: audience,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: subject
  };
  const signingInput = bytesToB64url(enc.encode(JSON.stringify(header))) + '.' +
    bytesToB64url(enc.encode(JSON.stringify(payload)));
  const key = await importVapidPrivate(privateJwk);
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(signingInput)
  );
  return signingInput + '.' + bytesToB64url(sig);
}

// ------------------------------------------------------------
//  הצפנת המטען (aes128gcm)
// ------------------------------------------------------------
export async function encryptPayload(plaintext, p256dhB64, authB64) {
  const uaPublicRaw = b64urlToBytes(p256dhB64);      // 65 בתים, נקודה לא דחוסה
  const authSecret = b64urlToBytes(authB64);         // 16 בתים

  const uaPublic = await crypto.subtle.importKey(
    'raw', uaPublicRaw, { name: 'ECDH', namedCurve: 'P-256' }, false, []
  );
  const asKeys = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']
  );
  const asPublicRaw = new Uint8Array(await crypto.subtle.exportKey('raw', asKeys.publicKey));

  const sharedBits = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: uaPublic }, asKeys.privateKey, 256
  );

  // IKM = HKDF(salt=auth, ikm=shared, info="WebPush: info\0" || ua_pub || as_pub)
  const sharedKey = await crypto.subtle.importKey('raw', sharedBits, 'HKDF', false, ['deriveBits']);
  const keyInfo = concat(enc.encode('WebPush: info'), new Uint8Array([0]), uaPublicRaw, asPublicRaw);
  const ikmBits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: authSecret, info: keyInfo }, sharedKey, 256
  );

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const ikmKey = await crypto.subtle.importKey('raw', ikmBits, 'HKDF', false, ['deriveBits']);
  const cekBits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: salt, info: concat(enc.encode('Content-Encoding: aes128gcm'), new Uint8Array([0])) },
    ikmKey, 128
  );
  const nonceBits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: salt, info: concat(enc.encode('Content-Encoding: nonce'), new Uint8Array([0])) },
    ikmKey, 96
  );

  const cek = await crypto.subtle.importKey('raw', cekBits, { name: 'AES-GCM' }, false, ['encrypt']);
  // 0x02 = מפריד הרשומה האחרונה
  const padded = concat(enc.encode(plaintext), new Uint8Array([2]));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: new Uint8Array(nonceBits), tagLength: 128 }, cek, padded
  ));

  // כותרת: salt(16) | rs(4) | idlen(1) | keyid(65)
  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, 4096);
  return concat(salt, rs, new Uint8Array([asPublicRaw.length]), asPublicRaw, ciphertext);
}

// ------------------------------------------------------------
//  שליחה
// ------------------------------------------------------------
/**
 * @param {{endpoint:string, keys:{p256dh:string, auth:string}}} subscription
 * @param {string} payload  מחרוזת (בדרך כלל JSON)
 * @param {{publicKey:string, privateJwk:object, subject:string, ttl?:number, urgency?:string}} vapid
 * @returns {{ok:boolean, status:number, gone:boolean, body:string}}
 */
export async function sendPush(subscription, payload, vapid) {
  const url = new URL(subscription.endpoint);
  const jwt = await vapidJwt(url.origin, vapid.subject || 'mailto:noreply@example.com', vapid.privateJwk);
  const body = await encryptPayload(payload, subscription.keys.p256dh, subscription.keys.auth);

  const res = await fetch(subscription.endpoint, {
    method: 'POST',
    headers: {
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      'TTL': String(vapid.ttl === undefined ? 900 : vapid.ttl),
      'Urgency': vapid.urgency || 'high',
      'Authorization': 'vapid t=' + jwt + ', k=' + vapid.publicKey
    },
    body: body
  });

  let text = '';
  try { text = await res.text(); } catch (e) { /* ignore */ }
  return {
    ok: res.ok,
    status: res.status,
    // 404/410 = המנוי בוטל, צריך למחוק אותו
    gone: res.status === 404 || res.status === 410,
    body: text.slice(0, 300)
  };
}
