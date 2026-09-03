// ============================================================
//  pillApp push server — Cloudflare Worker
//
//  מה השרת יודע: מנוי דחיפה טכני, אזור זמן, ורשימת תאריך+שעה של מנות.
//  מה השרת לא יודע: שמות תרופות, מינונים, תמונות, שמות אנשים.
//  הדחיפה נושאת רק {t:"08:00", d:"2026-09-03", n:0} — כל השאר
//  נבנה בטלפון עצמו מתוך הנתונים המקומיים.
// ============================================================
import { sendPush } from './webpush.js';

const BUILD = '2026-09-03 12:10 push-v1';

const WD = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function cors(origin) {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Max-Age': '86400'
  };
}

function json(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, cors(origin))
  });
}

function localParts(date, tz) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'short'
  });
  const p = {};
  for (const part of fmt.formatToParts(date)) p[part.type] = part.value;
  const hour = p.hour === '24' ? '00' : p.hour;
  return {
    date: p.year + '-' + p.month + '-' + p.day,
    hm: hour + ':' + p.minute,
    minutes: Number(hour) * 60 + Number(p.minute),
    weekday: WD[p.weekday]
  };
}

function toMinutes(hm) {
  const a = String(hm).split(':');
  return Number(a[0]) * 60 + Number(a[1]);
}

function vapidFrom(env) {
  return {
    publicKey: env.VAPID_PUBLIC_KEY,
    privateJwk: JSON.parse(env.VAPID_PRIVATE_JWK),
    subject: env.VAPID_SUBJECT || 'mailto:noreply@pillapp.local'
  };
}

// ------------------------------------------------------------
//  HTTP
// ------------------------------------------------------------
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '*';

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });

    // חותמת גרסה — לאימות שהמופע הפרוס באמת מריץ את הקוד הזה
    if (url.pathname === '/api/version') {
      return json({ build: BUILD, hasKeys: !!env.VAPID_PUBLIC_KEY }, 200, origin);
    }

    if (url.pathname === '/api/vapid') {
      if (!env.VAPID_PUBLIC_KEY) return json({ error: 'VAPID לא הוגדר' }, 500, origin);
      return json({ publicKey: env.VAPID_PUBLIC_KEY }, 200, origin);
    }

    if (url.pathname === '/api/register' && request.method === 'POST') {
      let b;
      try { b = await request.json(); } catch (e) { return json({ error: 'JSON לא תקין' }, 400, origin); }
      if (!b.subscription || !b.subscription.endpoint || !b.subscription.keys) {
        return json({ error: 'חסר subscription' }, 400, origin);
      }
      const id = (b.id && /^[A-Za-z0-9_-]{6,40}$/.test(b.id)) ? b.id : crypto.randomUUID();
      const prev = await env.SUBS.get('sub:' + id, 'json');
      const rec = {
        id: id,
        subscription: b.subscription,
        tz: b.tz || 'Asia/Jerusalem',
        // רשימת מנות מדויקת: "YYYY-MM-DD|HH:MM". מדויק לכל סוגי התדירות,
        // ומונע דחיפות ריקות בימים שאין בהם תרופה (Chrome שולל הרשאה על כאלה).
        slots: Array.isArray(b.slots)
          ? b.slots.filter(x => /^\d{4}-\d{2}-\d{2}\|\d{2}:\d{2}$/.test(x)).slice(0, 600)
          : [],
        nag: {
          intervalMin: Math.max(2, Math.min(120, Number(b.nag && b.nag.intervalMin) || 7)),
          maxHours: Math.max(1, Math.min(12, Number(b.nag && b.nag.maxHours) || 5))
        },
        quietWeekdays: Array.isArray(b.quietWeekdays) ? b.quietWeekdays.filter(n => n >= 0 && n <= 6) : [],
        acked: (prev && prev.acked) || {},
        updatedAt: Date.now()
      };
      await env.SUBS.put('sub:' + id, JSON.stringify(rec));
      return json({ ok: true, id: id, slots: rec.slots.length, lastSlot: rec.slots[rec.slots.length - 1] || null }, 200, origin);
    }

    if (url.pathname === '/api/ack' && request.method === 'POST') {
      let b;
      try { b = await request.json(); } catch (e) { return json({ error: 'JSON לא תקין' }, 400, origin); }
      const rec = await env.SUBS.get('sub:' + b.id, 'json');
      if (!rec) return json({ error: 'לא נמצא' }, 404, origin);
      const keys = Array.isArray(b.slots) ? b.slots : (b.date && b.time ? [b.date + '|' + b.time] : []);
      for (const k of keys) rec.acked[k] = 1;
      // ניקוי אישורים ישנים
      const cutoff = new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10);
      for (const k of Object.keys(rec.acked)) if (k.slice(0, 10) < cutoff) delete rec.acked[k];
      await env.SUBS.put('sub:' + b.id, JSON.stringify(rec));
      return json({ ok: true, acked: Object.keys(rec.acked).length }, 200, origin);
    }

    if (url.pathname === '/api/snooze' && request.method === 'POST') {
      let b;
      try { b = await request.json(); } catch (e) { return json({ error: 'JSON לא תקין' }, 400, origin); }
      const rec = await env.SUBS.get('sub:' + b.id, 'json');
      if (!rec) return json({ error: 'לא נמצא' }, 404, origin);
      if (!rec.snoozed) rec.snoozed = {};
      const mins = Math.max(1, Math.min(720, Number(b.minutes) || 10));
      rec.snoozed[b.date + '|' + b.time] = Date.now() + mins * 60000;
      await env.SUBS.put('sub:' + b.id, JSON.stringify(rec));
      return json({ ok: true, until: rec.snoozed[b.date + '|' + b.time] }, 200, origin);
    }

    if (url.pathname === '/api/unregister' && request.method === 'POST') {
      let b;
      try { b = await request.json(); } catch (e) { return json({ error: 'JSON לא תקין' }, 400, origin); }
      await env.SUBS.delete('sub:' + b.id);
      return json({ ok: true }, 200, origin);
    }

    // שליחת דחיפת בדיקה מיידית
    if (url.pathname === '/api/test' && request.method === 'POST') {
      let b;
      try { b = await request.json(); } catch (e) { return json({ error: 'JSON לא תקין' }, 400, origin); }
      const rec = await env.SUBS.get('sub:' + b.id, 'json');
      if (!rec) return json({ error: 'לא נמצא' }, 404, origin);
      const r = await sendPush(rec.subscription, JSON.stringify({ test: true }), vapidFrom(env));
      return json({ ok: r.ok, status: r.status, body: r.body }, r.ok ? 200 : 502, origin);
    }

    return json({ error: 'not found', build: BUILD }, 404, origin);
  },

  // ------------------------------------------------------------
  //  Cron — רץ כל דקה
  // ------------------------------------------------------------
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runSchedule(env));
  }
};

async function runSchedule(env) {
  if (!env.VAPID_PUBLIC_KEY) return;
  const vapid = vapidFrom(env);
  const now = new Date();
  const list = await env.SUBS.list({ prefix: 'sub:' });

  for (const entry of list.keys) {
    let rec;
    try { rec = await env.SUBS.get(entry.name, 'json'); } catch (e) { continue; }
    if (!rec || !rec.slots || !rec.slots.length) continue;

    let local;
    try { local = localParts(now, rec.tz); } catch (e) { local = localParts(now, 'Asia/Jerusalem'); }
    if (rec.quietWeekdays.indexOf(local.weekday) !== -1) continue;

    for (const slot of rec.slots) {
      const bar = slot.indexOf('|');
      if (slot.slice(0, bar) !== local.date) continue;
      const t = slot.slice(bar + 1);
      const due = local.minutes - toMinutes(t);
      if (due < 0) continue;
      if (due > rec.nag.maxHours * 60) continue;
      const isFirst = due === 0;
      const isNag = due > 0 && (due % rec.nag.intervalMin === 0);
      if (!isFirst && !isNag) continue;

      const key = local.date + '|' + t;
      if (rec.acked[key]) continue;
      if (rec.snoozed && rec.snoozed[key] && Date.now() < rec.snoozed[key]) continue;

      const payload = JSON.stringify({
        t: t, d: local.date,
        n: isFirst ? 0 : Math.floor(due / rec.nag.intervalMin)
      });
      const r = await sendPush(rec.subscription, payload, vapid);
      if (r.gone) { await env.SUBS.delete(entry.name); break; }
      if (!r.ok) console.log('push failed', r.status, r.body);
    }
  }
}
