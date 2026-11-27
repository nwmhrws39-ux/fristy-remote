---
title: Data Retention Policy
title_he: מדיניות שמירת מידע
version: 0.1-draft
effective: Not in effect – draft pending qualified legal review
updated: 2026-11-27
---

> **DRAFT.** The periods below are **implemented in code** (`apps/admin-server/src/api.ts` → `RETENTION`, `purgeExpired`, run daily by a Cloudflare Cron Trigger; PC log limit in `apps/desktop/src/core/db.ts`). Changing a period requires changing the code and this document together.

# Data Retention Policy

## Owner service (Cloudflare D1)
| Data | Kept for | Deleted by |
|---|---|---|
| Install record (ID, name, device type, platform, version, country, flags) | While in use; erased automatically **365 days after last use** (admins excepted) | Daily purge; or immediately via *Delete my data* |
| Daily activity (day, device type, version) | **180 days** | Daily purge |
| Hashed network address for code-attempt limits | **max. 2 days** | Daily purge |
| Personal message from the operator | Until the operator deletes it or the install is deleted | Operator / deletion |
| Invite codes | Until the operator deletes them | Operator |
| Admin audit log | **365 days** (and at most the newest 500 entries) | Daily purge / automatic cap |
| Abuse reports | While open; **365 days after resolution** | Daily purge |
| Admin sign-in tokens | **180 days** or until sign-out | Daily purge / sign-out |
| IP addresses | **Never stored** (processed transiently by Cloudflare to deliver requests) | – |

## PC app (local, on your computer)
| Data | Kept for |
|---|---|
| Security & connection log (incl. local/Tailscale address of connecting devices) | Newest **5,000** entries; plus the retention you choose in Privacy Center (default **90 days**); delete any time |
| File-transfer history | Same retention setting; delete any time |
| Paired devices & keys | Until you revoke/remove the device |
| Legal acceptance record | Until you withdraw or uninstall |
| Screen images, keystrokes, clipboard text | **Not stored** |

## Phone app (local)
Paired PCs (encrypted keychain), preferences, your name, install ID, acceptance record – until you remove them or uninstall the app. Screens and files are not stored unless **you** save them to Photos/Files.

## Backups
The owner service relies on Cloudflare D1's built-in point-in-time recovery, which keeps database history for up to **30 days** [verify against current Cloudflare documentation]. Deleted data can therefore persist in that recovery history for up to that period and is not used for any other purpose.

---

# מדיניות שמירת מידע
התקופות מיושמות בקוד (מחיקה יומית אוטומטית):
- רשומת התקנה – נמחקת **365 יום** אחרי השימוש האחרון (מלבד מנהלים), או מיד ב"מחק את המידע שלי".
- ימי שימוש – **180 יום**.
- כתובת רשת מגובבת להגבלת ניסיונות – **עד יומיים**.
- יומן מנהל – **365 יום** (ולכל היותר 500 רשומות).
- דיווחים – כל עוד פתוחים, ו-**365 יום** אחרי טיפול.
- כתובות IP – **לא נשמרות**.
- במחשב: יומן אבטחה ו-היסטוריית העברות – עד 5,000 רשומות ולפי תקופת השמירה שתבחר במרכז הפרטיות (ברירת מחדל 90 יום); ניתן למחיקה בכל עת. צילומי מסך, הקלדות ולוח – **לא נשמרים**.
- גיבוי: מנגנון השחזור של Cloudflare D1 שומר היסטוריה עד 30 יום [לאמת].
