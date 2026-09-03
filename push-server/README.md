# pillApp push server

Cloudflare Worker קטן ששולח את התזכורות. בלעדיו האפליקציה עדיין עובדת —
אבל רק כשהיא פתוחה. איתו, ההתראה מגיעה עם התמונה גם כשהטלפון נעול והאפליקציה סגורה,
וחוזרת עד שמסמנים.

## מה עובר לשרת ומה לא

| עובר לשרת | **לא** עובר לשרת |
|---|---|
| מנוי דחיפה טכני (endpoint + מפתחות של הדפדפן) | שמות תרופות |
| אזור זמן | מינונים ותנאי לקיחה |
| רשימת `"YYYY-MM-DD\|HH:MM"` של מנות ל-21 יום | תמונות |
| מרווח נדנוד וימים שקטים | שם המשתמש/ת |

מטען הדחיפה הוא `{"t":"08:00","d":"2026-09-03","n":0}` בלבד. ההתראה עצמה —
השם, הכמות, התמונה והאזהרה — נבנית ב-Service Worker בטלפון מתוך `IndexedDB` המקומי.
בנוסף, מטען הדחיפה מוצפן מקצה לקצה (RFC 8291); גם שרת הדחיפה של גוגל אינו יכול לקרוא אותו.

## פריסה

```bash
cd push-server
wrangler login                       # פעם אחת, פותח דפדפן
wrangler kv namespace create SUBS    # מעתיקים את ה-id ל-wrangler.toml
node -e "import('./src/webpush.js').then(async m=>{const k=await m.generateVapidKeys();console.log(k.publicKey);console.log(JSON.stringify(k.privateJwk));})"
wrangler secret put VAPID_PUBLIC_KEY     # הדבקת השורה הראשונה
wrangler secret put VAPID_PRIVATE_JWK    # הדבקת השורה השנייה
wrangler deploy
```

המפתחות אינם נשמרים בקובץ ואינם נכנסים ל-repo. גיבוי שלהם נשמר ב-Bitwarden
Secrets Manager תחת `PILLAPP_VAPID_PUBLIC_KEY` ו-`PILLAPP_VAPID_PRIVATE_JWK`.

**אם המפתח הפרטי אובד** — כל המנויים הקיימים מפסיקים לעבוד, וצריך להפעיל מחדש
את התזכורות בכל מכשיר (הגדרות ← תזכורות כשהאפליקציה סגורה ← הפעלה).

## אימות אחרי פריסה

```bash
curl https://<worker>.workers.dev/api/version
# {"build":"…","hasKeys":true}   ← hasKeys:false אומר שהסודות לא הוגדרו
```

## נקודות קצה

| נתיב | תיאור |
|---|---|
| `GET /api/version` | חותמת גרסה + האם הסודות מוגדרים |
| `GET /api/vapid` | המפתח הציבורי, לצורך `pushManager.subscribe` |
| `POST /api/register` | `{subscription, tz, slots[], nag, quietWeekdays, id?}` → `{id}` |
| `POST /api/ack` | `{id, slots[]}` — מנה סומנה, להפסיק לנדנד |
| `POST /api/snooze` | `{id, date, time, minutes}` |
| `POST /api/test` | דחיפת בדיקה מיידית |
| `POST /api/unregister` | `{id}` |

Cron רץ כל דקה, עובר על המנויים, ולכל מנה שהגיע זמנה שולח דחיפה —
ואז שוב כל `nag.intervalMin` דקות עד `nag.maxHours`, או עד אישור/נודניק.

## בדיקות שכבר רצו

- **הצפנה** — `http_ece` (ספרייה עצמאית) פענחה בהצלחה מטען שנוצר ב-`webpush.js`,
  כולל עברית. מאמת התאמה ל-RFC 8291/8188.
- **VAPID** — החתימה אומתה מול המפתח הציבורי הגולמי; 65 בתים לא־דחוסים, חתימה 64 בתים.
- **מקצה לקצה** — `wrangler dev` + שרת דחיפה מדומה: cron → הצפנה → HTTP → פענוח,
  והמטען שהתקבל תאם בדיוק. אחרי `/api/ack` הפסיקו הדחיפות.
