---
title: Jurisdiction Compliance Matrix
title_he: מטריצת עמידה בדרישות לפי תחום שיפוט
version: 0.1-draft
updated: 2026-11-27
---

> **DRAFT – ASSESSMENT, NOT A COMPLIANCE CLAIM.** "Status" describes what the code does today. Nothing here has been independently verified. Every "Applies?" judgement must be confirmed by a qualified lawyer. Facts that drive applicability: free app, no accounts, small private user group today, operator in Israel [confirm], hosted on Cloudflare (global/US), installed outside the app stores (sideloading/direct download).

| Law / policy | Applies? (preliminary) | Key requirements relevant to FRISTY Remote | Status in code/docs | Open actions |
|---|---|---|---|---|
| **Israel – Protection of Privacy Law, 5741-1981** | Likely yes (operator in Israel; owner service is a database of personal data: names, device data) | Duty to inform when collecting (s. 11): purpose, whether mandatory, recipients; data subject access (s. 13) and correction (s. 14); purpose limitation | Privacy Policy + onboarding notice; in-app export & delete; names editable | Counsel to confirm the notice wording and whether name + install ID data is "information" in a "database" requiring registration |
| **Israel – Amendment No. 13 (in force Aug 2025)** | Likely yes | Expanded definitions (incl. "information of special sensitivity" – e.g. location data, which we do **not** collect), enforcement powers and fines of the Privacy Protection Authority, narrower database-registration duty, DPO appointment for certain controllers | No special-sensitivity data collected; location feature blocked until LOCATION_PRIVACY_POLICY rules are met | Counsel: DPO requirement (likely not, at current scale), registration (likely not), notification obligations |
| **Israel – Privacy Protection (Data Security) Regulations, 5777-2017** | Likely yes for the owner-service database | Database definitions document, security level classification, access control, logging, security incident reporting | Security controls listed in SECURITY_POLICY; admin audit log; incident plan | Write the "database definitions document"; classify security level (likely basic); periodic review |
| **Israel – Consumer Protection Law, 5741-1981** | Limited (free app, no transactions) | No misleading statements; fair terms; cancellation rights if paid | Free; refund policy states no charges; no "lawsuit-proof"/"fully secure" claims | Revisit if monetized |
| **Israel – Computers Law, 5755-1995; Copyright Law, 5768-2007** | Yes | Unauthorized computer access is an offence – the app must not facilitate it; respect third-party copyrights | Pairing approval on the PC, permissions, visible indicators, AUP, no stealth; SBOM + licences | Choose a licence for own code |
| **EU GDPR** | Only if the app targets or monitors people in the EU (Art. 3(2)) – currently unlikely; becomes likely with public distribution | Lawful basis, transparency (Arts. 13–14), data subject rights (Arts. 15–22), records of processing, DPIA where high risk, breach notification (72 h), processor contracts, transfer safeguards, EU representative (Art. 27) | Bases documented; export (Art. 15/20) and erasure (Art. 17) implemented; retention schedule; breach plan | Appoint Art. 27 representative if targeting EU; sign Cloudflare DPA; records of processing |
| **UK GDPR / DPA 2018** | Same logic as EU | Same as GDPR + ICO registration fee may apply | Same | Same |
| **California CCPA / CPRA** | **Very unlikely** (thresholds: >$25M revenue, or buying/selling/sharing personal info of 100k+ consumers, or 50% revenue from selling data) | Notice at collection, right to know/delete/correct, "Do Not Sell or Share" | No sale/sharing; export & delete exist anyway | Re-evaluate if thresholds approached |
| **COPPA (USA)** | Unlikely (not child-directed, 18+ restriction, no actual knowledge) | Verifiable parental consent for under-13s | 18+ restriction; no child features | Confirm with counsel; set adult age rating |
| **Other child-privacy rules (UK AADC, GDPR Art. 8)** | Unlikely if 18+ is effective | Age-appropriate design / parental consent | 18+ only | See CHILD_PRIVACY_POLICY open items |
| **Apple App Store Review Guidelines** | Only if distributed on the App Store (today: sideloaded) | 4.2.7 *Remote desktop clients* (connect only to user-owned host; LAN requirement); 5.1.1 privacy policy, data minimization, **in-app account deletion** (no accounts → in-app data deletion provided); 5.1.2 data use; App Privacy "nutrition label"; Privacy Manifest | Privacy policy, data deletion, privacy labels drafted (APP_STORE_DISCLOSURES) | **Internet access via relay/Tailscale may conflict with 4.2.7's LAN requirement** – review before submission; add PrivacyInfo.xcprivacy |
| **Google Play Developer Policies** | Only if distributed on Play (today: no Android release) | Data safety form; User Data policy; prominent disclosure; Accessibility API & background location policies; Stalkerware policy; account deletion web link | Data-safety answers drafted; no accessibility or location APIs used | Keep accessibility/location features disabled unless policy-compliant declarations are made |

## Data protection officer / registration / DPIA (preliminary view)
- **DPO:** not required at current scale under Amendment 13 or GDPR Art. 37 (no large-scale monitoring, no special categories) – confirm.
- **Database registration (Israel):** after Amendment 13 registration is required only for limited categories (e.g. databases of 100k+ people mainly sold to others, or public bodies) – likely **not required** – confirm.
- **DPIA:** not strictly required at current scale, but a voluntary PIA was performed ([PRIVACY_IMPACT_ASSESSMENT.md](PRIVACY_IMPACT_ASSESSMENT.md)) because remote access is a high-impact capability.

---

# מטריצת עמידה בדרישות (סיכום)
טבלה זו היא **הערכה ראשונית ולא טענת עמידה**. בקצרה: חוק הגנת הפרטיות ותיקון 13 ותקנות אבטחת מידע – כנראה חלים על שירות הבעלים (יש לכתוב מסמך הגדרות מאגר ולסווג רמת אבטחה); חוק המחשבים – האפליקציה בנויה למנוע גישה בלי הרשאה; GDPR/UK GDPR – כנראה לא חלים כרגע, יחולו בהפצה ציבורית לאירופה; CCPA – כמעט בוודאות לא חל; COPPA – כנראה לא (גיל 18+); App Store – סעיף 4.2.7 עשוי להתנגש עם גישה מרחוק דרך האינטרנט; Google Play – אין שימוש ב-Accessibility או במיקום. כל ההכרעות דורשות אישור עורך דין.
