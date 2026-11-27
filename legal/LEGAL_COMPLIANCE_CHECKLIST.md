---
title: Legal Compliance & Pre-Release Checklist
title_he: רשימת בדיקה משפטית לפני שחרור
version: 0.1-draft
updated: 2026-11-27
---

> **FRISTY Remote is not ready for public or commercial distribution.** Items marked ⛔ block any public release. Nothing in this repository claims that the app is compliant, lawsuit-proof or completely secure. A qualified lawyer and an independent security tester must review the app before public distribution. The app must never be published automatically.

# Legal Compliance & Pre-Release Checklist

## ⛔ Release-blocking (must be resolved before public distribution)
| # | Item | Owner | Status |
|---|---|---|---|
| B1 | Qualified legal review of every document in `/legal`, incl. the jurisdiction matrix | Operator + counsel | ⛔ Open |
| B2 | Fill in operator identity, address, privacy/security contact (no invented details) | Operator | ⛔ Open |
| B3 | Choose applicable law/venue in the Terms; confirm consumer-law carve-outs | Counsel | ⛔ Open |
| B4 | Choose a licence for FRISTY Remote's own code (repo has no LICENSE file) | Operator | ⛔ Open |
| B5 | Code-sign the Windows installer (SmartScreen, update authenticity) | Operator | ⛔ Open |
| B6 | Independent security test / penetration test (pairing, relay, owner service, IPC) | External tester | ⛔ Open |
| B7 | Confirm Israeli database duties (definitions document, security level, registration not required) under the Data Security Regulations and Amendment 13 | Counsel | ⛔ Open |
| B8 | Processor terms with Cloudflare (DPA) and transfer mechanism; confirm D1 backup retention period | Operator | ⛔ Open |
| B9 | App Store: resolve Guideline 4.2.7 (remote desktop, LAN) for internet connections before submitting; add PrivacyInfo.xcprivacy | Operator | ⛔ Open (only if App Store is used) |
| B10 | Decide age rating (adult) in stores; confirm COPPA / GDPR Art. 8 position | Counsel | ⛔ Open |
| B11 | Bundle full licence texts of third-party components in release artifacts (Electron includes Chromium licences; npm packages' LICENSE files) | Maintainer | ⛔ Verify |

## Verified in code (automated tests – see "Test evidence")
| Requirement | Evidence | Status |
|---|---|---|
| Legal documents match behaviour (data collected, retention periods, permissions) | Manual cross-check against source at this commit; retention constants in `apps/admin-server/src/api.ts` | ✅ Drafted, needs legal review |
| Mandatory onboarding, no pre-selected boxes, optional features separate, version + timestamp recorded | E2E `legal onboarding…`; integration `records acceptance…` | ✅ |
| Phones refused until the PC owner accepts the terms | E2E (connection refused with `remote_disabled`) | ✅ |
| Phone sends nothing to the owner service before acceptance | Code path `checkIn()` guarded by `legalAccepted()` | ✅ (code review; no device test) |
| Renewed acceptance on version change | `isAccepted()` compares `LEGAL_VERSION`; test keeps documents' version in sync | ✅ |
| Remote sessions authenticated; unknown devices refused; revoked devices refused | E2E `unknown device rejected`, `revoked device can no longer connect` | ✅ |
| Per-feature permissions enforced | E2E `monitor allowed, power denied` | ✅ |
| Emergency revoke of all devices | E2E + integration | ✅ |
| Withdraw acceptance & reset | E2E + integration | ✅ |
| Local history deletion and retention (default 90 days, daily purge) | E2E `history deleted`; integration `applies the history retention period` | ✅ |
| Export of local data without keys/secrets | Integration `exports everything stored locally without keys` | ✅ |
| Server data export and deletion (user rights) | `api.test.ts` `a user can export and then delete…` | ✅ |
| Server retention purge (daily Cron Trigger) | `api.test.ts` `the daily purge applies the retention schedule` | ✅ |
| Abuse reporting works (app, website form), rate limited, owner can review/resolve | `api.test.ts`, `site.test.ts` | ✅ |
| No IP addresses stored by the owner service | Tests assert no IPv4 patterns in exports/overviews | ✅ |
| Brute-force protection on admin/invite codes; owner can see and lift limits | `api.test.ts` attempt-limit tests | ✅ |
| Legal website: all required pages, EN/HE, RTL, no cookies, no scripts, CSP | `site.test.ts` | ✅ |
| SBOM + licence audit; no unreviewed copyleft/unknown licences | `scripts/sbom.mjs --check` in CI | ✅ |
| Dependency vulnerability scanning | `npm audit` in CI (report), Dependabot | ✅ |
| No hidden tracking / recording functionality | No location, microphone, camera-capture or contacts code; Android permissions blocked in `app.json` | ✅ (code review) |
| Visible indicators during screen viewing / remote input; emergency shortcut | Existing implementation (`showIndicator`, Ctrl+Alt+Shift+F12) | ✅ |

## Known gaps (not release-blocking for the current private use, but tracked)
| Gap | Notes |
|---|---|
| No MFA for the owner admin role | Single admin code + rate limit + 180-day tokens |
| Time-limited / view-only remote sessions | Per-feature permissions exist ("view-only" = grant `screen` without `input`); no automatic session expiry yet |
| Owner-service export/delete authorized by install ID only | Install IDs are random and not shown to other users; consider signing requests |
| Accessibility audit | Not performed |
| `npm audit`: 3 moderate (minimatch ReDoS in `@expo/fingerprint`, build-time only) | Accepted: not shipped to users; suggested fix downgrades Expo |
| "Find my phone" / location, camera, microphone, phone control features | Not implemented; must satisfy LOCATION_PRIVACY_POLICY rules and a DPIA first |

## Test evidence (this commit)
- `npx vitest run` – unit + integration + owner-service + legal website tests.
- `xvfb-run -a node tests/e2e/electron-smoke.mjs` – real Electron app driven by Playwright with a simulated phone.
- CI runs both on every push (`.github/workflows/ci.yml`).
See the CI run for the exact results of a given commit.

---

# רשימת בדיקה לפני שחרור (סיכום)
**האפליקציה אינה מוכנה להפצה ציבורית או מסחרית.** חוסמים: בדיקת עורך דין לכל המסמכים, השלמת פרטי המפעיל, בחירת דין חל, בחירת רישיון לקוד, חתימה דיגיטלית למתקין, בדיקת חדירות עצמאית, בירור חובות מאגר מידע בישראל, הסכם עיבוד נתונים עם Cloudflare, סעיף 4.2.7 של App Store, דירוג גיל, צירוף טקסטי רישיונות.
מאומת בבדיקות אוטומטיות: מסך הסכמה ללא סימון מראש, חסימת טלפונים עד אישור, הרשאות, ביטול חירום, חזרה מהסכמה, מחיקת היסטוריה ותקופת שמירה, ייצוא ללא מפתחות, ייצוא ומחיקה בשרת, מחיקה אוטומטית, דיווחים, ללא שמירת IP, הגבלת ניסיונות, אתר משפטי דו-לשוני ללא עוגיות, SBOM וסריקת תלויות.
