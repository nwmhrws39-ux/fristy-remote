---
title: Security Incident & Data Breach Response Plan
title_he: נוהל תגובה לאירוע אבטחה ודליפת מידע
version: 0.1-draft
effective: Not in effect – draft pending qualified legal review
updated: 2026-11-27
---

> **DRAFT.** Reporting deadlines must be confirmed by counsel for each jurisdiction where users are located.

# Security Incident & Data Breach Response Plan

## Roles
Incident lead: [OPERATOR]. Legal advisor: [COUNSEL]. Technical responders: maintainers with access to GitHub and Cloudflare.

## 1. Detect
Sources: abuse/vulnerability reports (admin panel → Reports), admin audit log (failed admin codes, unexpected actions), "too many wrong codes" list, Cloudflare dashboard (error spikes), GitHub security alerts, user reports of unknown paired devices.

## 2. Contain (first hour)
| Scenario | Immediate action (tooling that exists) |
|---|---|
| Unauthorized remote access to a user's PC | User: Ctrl+Alt+Shift+F12, revoke all devices (PC → Devices / Privacy Center → Emergency revoke). Operator: block the suspicious install |
| Admin code or admin token leaked | `npx wrangler secret put ADMIN_CODE` with a new code; delete rows in `admin_tokens` (all admins sign in again) |
| Owner service compromised | Lock the app for everyone (admin panel → Lock), rotate Cloudflare API tokens, rotate ADMIN_CODE, redeploy from a clean commit |
| Malicious release published | Delete the GitHub release, publish a fixed version, set *Minimum version* above the bad one |
| Emergency shutdown of the service | Lock the app for everyone; if needed, disable the Worker in Cloudflare (apps keep their last lock state) |
| Exposed credentials in the repository | Revoke/rotate immediately; purge from history; check audit log |
| Location information exposure | Not applicable today (no location collected); plan must be extended before any location feature ships |

## 3. Investigate
Determine what data, which installs, time window and cause, using the admin audit log, Cloudflare logs and git history. Preserve evidence; do not collect more user content than needed.

## 4. Remediate
Fix the root cause, add a regression test, release, raise *Minimum version*, document in the incident record.

## 5. Notify – assess within 24 hours of awareness
| Regime | Requirement (to be confirmed by counsel) |
|---|---|
| Israel – Privacy Protection (Data Security) Regulations, 5777-2017 | A **severe security incident** in a database of medium/high security level must be reported to the Privacy Protection Authority **immediately**; the Authority may require notifying data subjects. Classification of the owner service database to be determined. |
| GDPR / UK GDPR | Notify the supervisory authority **within 72 hours** unless unlikely to result in a risk; notify individuals without undue delay if high risk. Applies only if GDPR applies (see compliance matrix). |
| US state laws (e.g. California Civil Code §1798.82) | Notification "in the most expedient time possible" for covered personal information; likely limited relevance (no names/IDs of legal significance stored). |
| App stores | Follow Apple/Google developer requirements if distributed there. |

Notify affected users in the app (announcement / personal message) and on the legal website, in plain language: what happened, what data, what we did, what they should do.

## 6. Review
Post-incident review within 2 weeks; update this plan and the checklist.

---

# נוהל תגובה לאירוע אבטחה
1. **זיהוי:** דיווחים, יומן מנהל, רשימת חסומים, Cloudflare, התראות GitHub.
2. **הכלה:** קיצור חירום וביטול מכשירים; חסימת התקנה; החלפת קוד מנהל ומחיקת אסימונים; נעילת האפליקציה לכולם; מחיקת גרסה זדונית והעלאת גרסה מינימלית.
3. **בירור:** איזה מידע, אילו התקנות, טווח זמן וסיבה – בלי לאסוף יותר מהנדרש.
4. **תיקון:** תיקון, בדיקה, גרסה חדשה.
5. **הודעה – הערכה תוך 24 שעות:** בישראל – אירוע אבטחה חמור במאגר ברמת אבטחה בינונית/גבוהה מדווח לרשות להגנת הפרטיות **מיד**; GDPR – תוך **72 שעות** אם חל. יש לאמת עם עורך דין.
6. **הפקת לקחים** תוך שבועיים.
