---
title: Security Policy
title_he: מדיניות אבטחה
version: 0.1-draft
effective: Not in effect – draft pending qualified legal review
updated: 2026-11-27
---

> **DRAFT.** This describes what is implemented. It is **not** a claim that the software is completely secure, and it has **not** been independently penetration-tested.

# Security Policy

## Implemented controls
| Area | Control | Where |
|---|---|---|
| Device pairing | One-time pairing code / QR (expiring, limited attempts), verification code shown on PC and phone, approval **on the PC** with per-feature permissions | `apps/desktop/src/core/pairing.ts`, `server.ts` |
| Encryption in transit (devices) | X25519 key agreement + XSalsa20-Poly1305 (TweetNaCl, audited library) end-to-end between phone and PC, also over the relay | `packages/shared/src/crypto.ts` |
| Replay protection | Per-session keys and message counters in the secure channel | `packages/shared` |
| Authorization | Every RPC method maps to one permission; unknown methods/params rejected (zod validation) | `packages/protocol/src/methods.ts` |
| Rate limiting / brute force | Pairing attempts, connection attempts per address, admin & invite codes (5 / 10 per hour) | `server.ts`, `apps/admin-server/src/api.ts` |
| Owner service | HTTPS/TLS (Cloudflare), admin code verified server-side (constant-time hash compare), random 256-bit admin tokens stored as SHA-256 hashes, tokens expire after 180 days | `apps/admin-server` |
| Secret storage | PC: Windows DPAPI via Electron `safeStorage`; phone: iOS Keychain / Android Keystore via `expo-secure-store` | `identity.ts`, `store/secure.ts` |
| Least privilege | No arbitrary command execution; only owner-approved apps, URLs and folders; no UAC bypass; no hidden mode | design |
| Visible sessions | Indicator while screen viewing / remote input is active; emergency shortcut Ctrl+Alt+Shift+F12; revoke devices any time | `main/index.ts` |
| Renderer isolation | Context isolation, no Node in renderer, allowlisted & schema-validated IPC | `main/ipc*.ts` |
| Updates | Downloaded over HTTPS from GitHub Releases with SHA-512 checksums (`latest.yml`, electron-updater) | `main/updater.ts` |
| Dependency scanning | `npm audit` in CI and Dependabot alerts | `.github/` |

## Known gaps (tracked in LEGAL_COMPLIANCE_CHECKLIST.md)
- The Windows installer is **not code-signed**; Windows SmartScreen warns, and update authenticity relies on GitHub + HTTPS.
- No multi-factor authentication for the owner admin role (single admin code + rate limit).
- The owner service's data-export/delete endpoints are authorized by the random install ID only.
- No time-limited remote sessions yet (access lasts until revoked).
- No independent security audit or penetration test has been performed.

## Reporting vulnerabilities
See [VULNERABILITY_DISCLOSURE.md](VULNERABILITY_DISCLOSURE.md).

---

# מדיניות אבטחה
מיושם: צימוד עם קוד שפג ואישור במחשב, הצפנה מקצה לקצה (TweetNaCl), הרשאה לכל פעולה, הגבלת ניסיונות, TLS לשירות הבעלים, אסימוני מנהל אקראיים שנשמרים כ-Hash ופגים אחרי 180 יום, אחסון סודות מוצפן ע״י מערכת ההפעלה, אין הרצת פקודות שרירותית ואין מצב חשאי, חיווי גלוי וקיצור חירום, סריקת תלויות.
פערים ידועים: המתקין אינו חתום דיגיטלית; אין אימות דו-שלבי למנהל; אין עדיין חיבורים מוגבלי זמן; לא בוצעה בדיקת חדירות עצמאית. **אין טענה שהמערכת מאובטחת לחלוטין.**
