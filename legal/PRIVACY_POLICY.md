---
title: Privacy Policy
title_he: מדיניות פרטיות
version: 0.1-draft
effective: Not in effect – draft pending qualified legal review
updated: 2026-11-27
---

> **DRAFT – NOT LEGAL ADVICE.** This document was drafted from the actual source code of FRISTY Remote and must be reviewed by a qualified lawyer before the app is distributed publicly or commercially. Items in `[brackets]` must be completed by the operator. No compliance certification is claimed.

# Privacy Policy

## 1. Who we are
FRISTY Remote ("the app") consists of a Windows desktop app ("PC app"), a phone app ("phone app"), an optional owner service ("owner service") and an optional self-hosted relay. It is operated by **[OPERATOR LEGAL NAME]**, **[ADDRESS]**.
Privacy contact: **[PRIVACY CONTACT EMAIL]**. You can also use the in-app *Report a problem* form.

## 2. The short version
- Remote control happens **directly between your own phone and your own PC**, end-to-end encrypted. Screens, files, clipboard text and keystrokes are **not** sent to us and are **not** stored by us.
- The owner service stores only what is needed to run the app for the people the operator shares it with: a random install ID, the name you type, device type, platform, app version, country and activity days. **No IP addresses are stored.**
- There is **no advertising, no analytics SDK, no selling of data, no AI training** on your content.
- You can export and delete your owner-service data from the app at any time (Settings → Privacy).

## 3. What we collect, why, and on which legal basis

| Data | Where it is kept | Purpose | Legal basis (GDPR, where applicable) | Required? |
|---|---|---|---|---|
| Install ID (random), the name you type, device type (phone/PC), platform, app version | Owner service (Cloudflare D1) | Operate the app, show the operator who uses it, lock/block misuse, require updates | Contract (Art. 6(1)(b)); legitimate interest in preventing misuse (Art. 6(1)(f)) | Yes – the app does not work without the check-in |
| Country (2-letter code supplied by Cloudflare) | Owner service | Usage statistics by country | Legitimate interest | Yes (derived automatically) |
| Days on which the app was used, app version that day | Owner service, 180 days | Usage statistics | Legitimate interest | Yes |
| Hashed network address (one-way SHA-256, truncated) | Owner service, max. 2 days | Limit wrong admin/invite codes (brute-force protection) | Legitimate interest / security | Yes, only when a code is typed |
| Messages the operator sends to you, invite codes you redeem, beta-tester flag | Owner service | Features you see in the app | Contract | Only if used |
| Abuse / security reports you submit (category, text, optional contact) | Owner service, until resolved + 365 days | Investigate misuse | Legitimate interest / legal obligation | Voluntary |
| Admin audit log (operator actions only) | Owner service, 365 days | Accountability | Legitimate interest | – |
| Paired devices, their public keys and permissions | PC app (local) and phone app (local, encrypted keychain) | Authenticate your devices | Contract | Yes |
| Security & connection log incl. the **local network/Tailscale address** of connecting devices | PC app only (local), last 5,000 entries, deletable | Show you who connected; detect unauthorized attempts | Legitimate interest / your own use | Yes (local only) |
| File-transfer history (file names, sizes) | PC app only (local) | Show transfer progress/history | Your own use | Yes (local only) |
| Legal acceptance record (document versions, timestamps) | PC app and phone app (local) | Prove acceptance of the terms | Contract / legal obligation | Yes |

**Not collected:** contacts, SMS, call logs, location/GPS, microphone audio, camera images (the camera is used only to scan the pairing QR code, on the phone, and the image never leaves the phone), browsing history, advertising IDs, payment data.

## 4. Remote-control data (screen, input, files, clipboard)
When you use a feature, the data travels **end-to-end encrypted** (X25519 key exchange + XSalsa20-Poly1305, TweetNaCl library) between your phone and your PC – over your local network, Tailscale, or an optional relay that only forwards encrypted bytes. Screen images, keystrokes, clipboard text and files are processed in memory and are **not stored** by the app (files are saved only where you send them). The PC shows a visible indicator while a phone views the screen or controls the mouse/keyboard, and every feature requires a per-device permission you grant on the PC.

## 5. Device permissions (phone)
| Permission | Used for | If refused |
|---|---|---|
| Camera | Scanning the pairing QR code only | Type the pairing code instead |
| Local network | Finding and connecting to your PC | Only internet routes (Tailscale/relay) work |
| Photos (read / add) | Choosing media to send to the PC; saving media/screenshots you receive | Those features are unavailable |
| Notifications | Alerts from your PC (e.g. transfer finished) | No alerts |

## 6. Service providers and international transfers
| Provider | Role | Data | Location |
|---|---|---|---|
| Cloudflare, Inc. | Hosts the owner service (Workers, D1, Durable Objects) | Owner-service data above; processes IP addresses transiently to deliver requests | Global network, incl. USA |
| GitHub, Inc. (Microsoft) | Hosts app downloads and update information | Your IP address and user agent when the app checks for updates | USA |
| ntfy.sh (only if the operator enables new-user notifications) | Sends a push notification to the operator | "New user joined", device type and country – **no names, no IDs** | EU/USA (provider) |
| Tailscale (only if **you** install it) | Private network between your devices | Governed by Tailscale's own privacy policy | – |
| Apple / Sideloadly (iPhone installation) | App installation outside the App Store | Governed by their own terms | – |

Transfers outside Israel/the EEA rely on [MECHANISM TO BE CONFIRMED BY COUNSEL – e.g. adequacy decision, Standard Contractual Clauses in the providers' data processing addenda].

## 7. Retention
See [DATA_RETENTION_POLICY.md](DATA_RETENTION_POLICY.md). In short: activity days 180 days; inactive installs erased after 365 days; hashed network addresses max. 2 days; audit log 365 days; local PC logs until you delete them (Privacy Center → Delete history) or until they roll over after 5,000 entries.

## 8. Security
End-to-end encryption between devices, per-device keys and permissions, expiring pairing codes, brute-force limits, OS-encrypted storage of secrets, TLS for the owner service, no inbound server reachable without pairing. No system is perfectly secure; see [SECURITY_POLICY.md](SECURITY_POLICY.md).

## 9. Your rights
Depending on where you live (e.g. Israel's Protection of Privacy Law, GDPR/UK GDPR, CCPA/CPRA) you may have the right to access, correct, delete, restrict or object to processing, to data portability, to withdraw consent, and to complain to a supervisory authority (in Israel: the Privacy Protection Authority).
- **Access / portability:** phone app → Settings → Privacy → *Export my data*; PC app → Privacy Center → *Export*.
- **Deletion:** *Delete my data on the server* in either app; uninstalling removes local data. See [DATA_DELETION_POLICY.md](DATA_DELETION_POLICY.md).
- **Correction:** change your name in the app, or contact us.
- **Withdraw acceptance / stop using:** Privacy Center → *Withdraw and reset*.
We do not sell or "share" personal information for cross-context behavioural advertising.

## 10. Children
The app is not directed at children and may only be used by people aged 18 or older. We do not knowingly collect data from children. See [CHILD_PRIVACY_POLICY.md](CHILD_PRIVACY_POLICY.md).

## 11. Changes
Material changes get a new version number; the apps ask you to accept again before continuing.

---

# מדיניות פרטיות

> **טיוטה – אינה ייעוץ משפטי.** המסמך נכתב על בסיס קוד המקור בפועל של FRISTY Remote, ויש להעבירו לבדיקה של עורך דין מוסמך לפני הפצה ציבורית או מסחרית. פרטים בסוגריים מרובעים ימולאו על ידי המפעיל. לא נטענת עמידה בתקן או הסמכה כלשהי.

## 1. מי אנחנו
FRISTY Remote כוללת אפליקציה למחשב Windows, אפליקציה לטלפון, שירות בעלים אופציונלי וממסר (Relay) אופציונלי באחסון עצמי. המפעיל: **[שם משפטי של המפעיל]**, **[כתובת]**. פנייה בנושאי פרטיות: **[כתובת דוא״ל]**, או טופס "דיווח על בעיה" באפליקציה.

## 2. בקצרה
- השליטה מרחוק מתבצעת **ישירות בין הטלפון שלך למחשב שלך**, בהצפנה מקצה לקצה. מסך, קבצים, טקסט מהלוח והקלדות **לא נשלחים אלינו ולא נשמרים אצלנו**.
- שירות הבעלים שומר רק את הנדרש להפעלת האפליקציה: מזהה התקנה אקראי, השם שהקלדת, סוג מכשיר, מערכת, גרסה, מדינה וימי שימוש. **כתובות IP אינן נשמרות.**
- **אין** פרסומות, **אין** כלי אנליטיקה, **אין** מכירת מידע ו**אין** אימון בינה מלאכותית על התוכן שלך.
- אפשר לייצא ולמחוק את המידע בשרת בכל עת (הגדרות ← פרטיות).

## 3. איזה מידע נאסף, למה ועל איזה בסיס
| מידע | היכן נשמר | מטרה | חובה? |
|---|---|---|---|
| מזהה התקנה, השם שהקלדת, סוג מכשיר, מערכת, גרסה | שירות הבעלים (Cloudflare) | הפעלת האפליקציה, ניהול משתמשים, נעילה/חסימה במקרה שימוש לרעה, עדכונים | כן |
| מדינה (קוד בן 2 אותיות מ-Cloudflare) | שירות הבעלים | סטטיסטיקה לפי מדינה | כן (נגזר אוטומטית) |
| ימי שימוש וגרסה | שירות הבעלים, 180 יום | סטטיסטיקה | כן |
| כתובת רשת מגובבת (Hash חד-כיווני) | שירות הבעלים, עד יומיים | הגבלת ניסיונות קוד שגויים | רק כשמקלידים קוד |
| הודעות אישיות, קודי הזמנה, סימון בודק בטא | שירות הבעלים | תכונות באפליקציה | רק אם נעשה שימוש |
| דיווחים על שימוש לרעה שאתה שולח | שירות הבעלים | בירור שימוש לרעה | וולונטרי |
| מכשירים מצומדים, מפתחות והרשאות | במחשב ובטלפון בלבד | אימות המכשירים שלך | כן |
| יומן אבטחה וחיבורים כולל כתובת הרשת המקומית/Tailscale של המכשיר המתחבר | במחשב בלבד, 5,000 רשומות אחרונות, ניתן למחיקה | להראות לך מי התחבר | כן (מקומי בלבד) |
| היסטוריית העברת קבצים (שם, גודל) | במחשב בלבד | הצגת התקדמות | כן (מקומי בלבד) |
| רישום אישור המסמכים המשפטיים (גרסה ומועד) | במחשב ובטלפון | הוכחת הסכמה לתנאים | כן |

**לא נאסף:** אנשי קשר, SMS, שיחות, מיקום GPS, הקלטות מיקרופון, תמונות מצלמה (המצלמה משמשת רק לסריקת קוד QR בטלפון והתמונה לא יוצאת ממנו), היסטוריית גלישה, מזהי פרסום, פרטי תשלום.

## 4. מידע של שליטה מרחוק
המידע עובר **מוצפן מקצה לקצה** (X25519 + XSalsa20-Poly1305, ספריית TweetNaCl) בין הטלפון למחשב – ברשת הביתית, ב-Tailscale או דרך ממסר שמעביר רק בייטים מוצפנים. תמונות מסך, הקלדות, לוח וקבצים מעובדים בזיכרון ו**לא נשמרים**. המחשב מציג חיווי גלוי בזמן צפייה במסך או שליטה, וכל תכונה דורשת הרשאה נפרדת לכל מכשיר שאתה מאשר במחשב.

## 5. הרשאות בטלפון
מצלמה – סריקת קוד QR בלבד; רשת מקומית – חיבור למחשב; תמונות – בחירה ושמירה של מדיה; התראות – הודעות מהמחשב. סירוב משבית רק את התכונה הרלוונטית.

## 6. ספקי שירות והעברה לחו״ל
Cloudflare (אחסון שירות הבעלים, כולל ארה״ב), GitHub (הורדות ובדיקת עדכונים – רואה את כתובת ה-IP שלך), ntfy.sh (רק אם המפעיל הפעיל התראות – "משתמש חדש", סוג מכשיר ומדינה, ללא שמות), Tailscale (רק אם אתה התקנת), Apple/Sideloadly (התקנה). מנגנון ההעברה לחו״ל: [ייקבע על ידי עורך דין].

## 7. תקופות שמירה
ימי שימוש – 180 יום; התקנות לא פעילות נמחקות אחרי 365 יום; כתובות מגובבות – עד יומיים; יומן מנהל – 365 יום; יומנים מקומיים במחשב – עד שתמחק אותם. פירוט ב-DATA_RETENTION_POLICY.md.

## 8. אבטחה
הצפנה מקצה לקצה, מפתחות והרשאות לכל מכשיר, קודי צימוד שפגים, הגבלת ניסיונות, אחסון סודות מוצפן ע״י מערכת ההפעלה, TLS לשירות הבעלים. אין מערכת מאובטחת לחלוטין.

## 9. הזכויות שלך
לפי הדין החל (חוק הגנת הפרטיות, GDPR ועוד) ייתכן שיש לך זכות עיון, תיקון, מחיקה, הגבלה, התנגדות, ניוד מידע וחזרה מהסכמה, וכן זכות להגיש תלונה לרשות להגנת הפרטיות.
- **עיון/ייצוא:** טלפון ← הגדרות ← פרטיות ← ייצא את המידע שלי; מחשב ← מרכז פרטיות ← ייצוא.
- **מחיקה:** "מחק את המידע שלי מהשרת" בכל אחת מהאפליקציות; הסרת האפליקציה מוחקת את המידע המקומי.
- **תיקון:** שינוי השם באפליקציה או פנייה אלינו.
אנחנו לא מוכרים מידע אישי.

## 10. ילדים
האפליקציה אינה מיועדת לילדים ומותרת לשימוש מגיל 18 בלבד.

## 11. שינויים
שינוי מהותי מקבל מספר גרסה חדש, והאפליקציות יבקשו אישור מחדש.
