# pillApp — סיכום פרויקט

## תיאור כללי

אפליקציית ווב (PWA) אישית בעברית לניהול ותזכורות לקיחת תרופות, מותאמת למשתמש/ת מבוגר/ת:
טיפוגרפיה ענקית, ניגודיות גבוהה, ומטרות מגע גדולות. **אין שרת, אין בסיס נתונים, אין שלב בנייה** —
קבצים סטטיים בלבד + ES modules, כל הנתונים ב-localStorage של המכשיר.

**חי בכתובת:** <https://idoyan-spec.github.io/pillapp/>
**Repo:** <https://github.com/idoyan-spec/pillapp> (ציבורי)
**גרסה:** `2026-09-02 20:10 v2 first-release` — מוצגת בתחתית כל מסך.

## קבצים עיקריים

| קובץ | תפקיד |
|-------|--------|
| `index.html` | מעטפת: 5 מסכים, שכבות (תזכורת/זכוכית/שבת/גיליון), סרגל טאבים |
| `css/app.css` | מערכת עיצוב אחת — טוקנים, מצב בהיר/כהה, RTL, טיפוגרפיה גדולה |
| `js/store.js` | סכמת נתונים, localStorage, עזרי תאריך, CRUD, קבוע `BUILD` |
| `js/schedule.js` | חישוב מנות ליום, איחורים, ימים שקטים, מלאי, היענות |
| `js/text.js` | כל הניסוח העברי האישי (שם + לשון מגדרית) |
| `js/notify.js` | לולאת בדיקה כל 15 שנ׳, נדנוד, נודניק, קול, יום שקט, Wake Lock |
| `js/sensors.js` | DeviceMotion (זיהוי השכמה) + Geolocation (יציאה מהבית) |
| `js/tools.js` | מצלמה משותפת: פנס + זכוכית מגדלת + דחיסת תמונות |
| `js/gemini.js` | זיהוי מצילום (responseSchema) + כרטיס מידע (google_search grounding) |
| `js/dom.js` | `$`, `el`, טוסטים, גיליון תחתון, `confirmBig`/`promptBig` |
| `js/ui.js` | חמשת המסכים, התזכורת הגדולה, זכוכית מגדלת, מסך שבת |
| `js/editors.js` | עורך תרופה, כרטיס מידע, עורך פרוצדורה |
| `js/app.js` | אתחול, רישום SW, חיווט, מסך "ברוכים הבאים" |
| `sw.js` | עבודה בלי רשת + טיפול בלחיצה על התראה (כולל actions) |
| `manifest.webmanifest` | הגדרות PWA להתקנה במסך הבית |
| `start.bat` | שרת מקומי ב-8899 לפיתוח ולבדיקה |
| `assets/icon.ico` + PNG | אייקון (נוצר ב-Gemini 3 Pro Image), משמש לחלון, ל-.lnk ולתיקייה |

## טכנולוגיות בשימוש

- Vanilla JS (ES modules), ללא framework וללא bundler
- PWA: Service Worker, Web App Manifest, Wake Lock API
- Notifications API + Service Worker notification actions
- Web Speech API (`speechSynthesis`, he-IL) + WebAudio לצלילים מסונתזים
- MediaDevices: `torch` ו-`zoom` constraints (פנס + זכוכית מגדלת)
- DeviceMotion API, Geolocation API
- **Gemini 3.8 Flash** — vision + `responseSchema` לזיהוי מצילום, `google_search` grounding לכרטיס מידע
- אחסון: localStorage בלבד

## איך להשתמש

### הרצה מקומית
לחיצה כפולה על `התרופות שלי.lnk` (בשולחן העבודה ובשורש הפרויקט), או `start.bat`.
נפתח ב-<http://localhost:8899>. דורש Python בנתיב.

### התקנה בטלפון
נכנסים ל-<https://idoyan-spec.github.io/pillapp/> ← תפריט הדפדפן ← **"הוספה למסך הבית"**.
חייב HTTPS: Service Worker, התראות, מצלמה ומיקום אינם עובדים על `http://` בכתובת LAN.

### מפתח Gemini
נשמר **רק ב-localStorage של המכשיר**, לעולם לא בקוד ולא ב-repo.
משיגים חינם ב-<https://aistudio.google.com/apikey> ומדביקים ב**הגדרות ← זיהוי מצילום ומידע על תרופות**.
בלי מפתח האפליקציה עובדת במלואה פרט לזיהוי-מצילום ולכרטיס המידע.

### פריסה (Deploy)
```bash
cd E:\MAIN_CLAUDE\pillApp
git add -A && git commit -m "…" && git push
```
GitHub Pages בונה אוטומטית מ-`master`, שורש הריפו. אימות אחרי פריסה:
```bash
curl -s https://idoyan-spec.github.io/pillapp/js/store.js | grep "BUILD ="
```
**חשוב:** בכל שינוי קוד חייבים לעדכן את `BUILD` **גם ב-`js/store.js` וגם ב-`sw.js`** —
ב-`sw.js` הוא קובע את שם ה-cache, ובלעדיו הדפדפן ימשיך להגיש קוד ישן.

## החלטות ארכיטקטורה

- **מאגר משרד הבריאות נבדק ונפסל.** `israeldrugs.health.gov.il` מוגן ב-WAF (F5) שמחזיר דף
  שגיאה לכל בקשה שאינה דפדפן אמיתי, ו-`data.gov.il` לא מפרסם את מאגר התרופות. פרוקסי שמחקה
  דפדפן היה נשבר כל כמה שבועות. במקום זה — Gemini עם חיפוש מקורקע, שמחזיר גם קישורים למקורות.
- **אפס שרת.** נבדק ש-`generativelanguage.googleapis.com` מחזיר
  `Access-Control-Allow-Origin` לדומיין ה-Pages, ולכן הדפדפן קורא ל-Gemini ישירות.
- **מגבלת התראות ברקע.** לדפדפנים אין תזמון התראות אמין כשהאפליקציה סגורה לגמרי
  (`Notification Triggers` לא נכנס לשימוש רחב). מה שעובד: תזכורות מדויקות כשהאפליקציה חיה
  (foreground או background), ו"השלמת פערים" מיידית בפתיחה מחדש. נדנוד מובטח בטלפון נעול
  היה מחייב שרת Web Push — לא נבנה.

## היסטוריית שינויים

| תאריך | שינוי |
|--------|-------|
| 2026-09-02 | בנייה מאפס — כל היכולות, אימות ב-Chrome, אייקונים, קיצור דרך ואייקון תיקייה, פרסום ל-GitHub Pages ואימות שהגרסה החיה היא v2 |
