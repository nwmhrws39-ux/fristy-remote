---
title: Data Deletion Policy
title_he: מדיניות מחיקת מידע
version: 0.1-draft
effective: Not in effect – draft pending qualified legal review
updated: 2026-11-27
---

> **DRAFT.** Every path below is implemented and covered by automated tests (see TEST_RESULTS in `legal/LEGAL_COMPLIANCE_CHECKLIST.md`).

# Data Deletion Policy

FRISTY Remote has **no user accounts**. Each installation of the app is identified only by a random install ID. Deleting your data means deleting that installation's records.

## How to delete
| What | How | Effect |
|---|---|---|
| Your data on the owner service | Phone: Settings → Privacy → **Delete my data on the server**. PC: Privacy Center → **Delete my data on the server** | Immediately erases the install record, activity days, personal messages, rate-limit links and sign-in tokens. Reports you sent stay for the operator but are **unlinked** from you. If you keep using the app afterwards, it checks in again as a new record. |
| Local history on the PC (security log, transfers) | Privacy Center → **Delete history** | Deletes all log and transfer entries. |
| A paired phone or PC | PC: Devices → Revoke/Remove. Phone: Settings → Forget PC | The device can no longer connect; its key is discarded. |
| Everything on the PC | Privacy Center → **Withdraw and reset**, then uninstall | Revokes all devices, deletes history and the acceptance record. |
| Everything on the phone | Settings → Privacy → **Withdraw and reset**, then delete the app | Removes paired PCs, preferences, name and acceptance record from the device. |
| Clipboard history, screenshots, recordings, location history, notification content, backups | The app **does not create** any of these on its own | Nothing to delete. Screenshots you saved to Photos are deleted in Photos. |

## Without the app
If you no longer have the app, use the **/delete-account** page of the legal website, which explains the steps, or the report form (category *other*) with enough detail for the operator to find your record (for example the name you used). The operator deletes it from the admin panel (**Remove**) within [30] days. We may ask for information to confirm the request concerns your installation; we will not ask for more than necessary.

## Backups and legal holds
Deleted records may remain in Cloudflare's database recovery history for up to 30 days [verify]. Information may be retained longer only if required by law (for example an open abuse investigation), and only for that purpose.

---

# מדיניות מחיקת מידע
אין חשבונות משתמש – כל התקנה מזוהה רק במזהה אקראי.
- **המידע בשרת:** טלפון ← הגדרות ← פרטיות ← "מחק את המידע שלי מהשרת"; מחשב ← מרכז פרטיות. נמחקים מיד: רשומת ההתקנה, ימי שימוש, הודעות אישיות, קישורי הגבלת ניסיונות ואסימוני כניסה. דיווחים שלך נשארים אצל המפעיל אבל **מנותקים** ממך.
- **היסטוריה מקומית במחשב:** מרכז פרטיות ← "מחק היסטוריה".
- **מכשיר מצומד:** מחשב ← מכשירים ← ביטול; טלפון ← הגדרות ← שכח מחשב.
- **הכול:** "חזרה מהסכמה ואיפוס" ואז הסרת האפליקציה.
- האפליקציה **לא יוצרת** בעצמה היסטוריית לוח, צילומי מסך, הקלטות, היסטוריית מיקום או גיבויים.
- ללא האפליקציה: עמוד ‎/delete-account באתר או טופס הדיווח; המפעיל ימחק תוך [30] יום.
