---
title: App Store & Google Play Disclosures (prepared, not submitted)
version: 0.1-draft
updated: 2026-11-27
---

> **DRAFT.** FRISTY Remote is currently **not** distributed through the App Store or Google Play. These answers describe the current code and must be re-checked against the stores' forms at submission time.

## Apple – App Privacy ("nutrition label")
| Data type | Collected? | Linked to user? | Tracking? | Purpose |
|---|---|---|---|---|
| Name (self-chosen display name) | Yes | Yes (to the install) | No | App functionality |
| User ID (random install ID) | Yes | Yes | No | App functionality |
| Product interaction (days active, version) | Yes | Yes | No | Analytics (first-party only) |
| Other user content (abuse reports, optional contact) | Yes, voluntary | Yes, if install ID attached | No | App functionality / security |
| Coarse location (country code derived from network) | Yes | Yes | No | Analytics |
| Precise location, contacts, photos, audio, browsing, health, financial | **No** | – | – | – |
**Tracking (ATT):** none. **Third-party SDKs for ads/analytics:** none.
**Account deletion (5.1.1(v)):** no accounts; in-app data deletion provided (Settings → Privacy).
**Remote desktop (4.2.7):** connects only to the user's own PC after on-PC approval. ⚠️ Internet access via relay/Tailscale may conflict with the LAN requirement – must be resolved before submission.
**Permission strings (Info.plist):** Camera – QR pairing only; Local network – connect to your PC; Photos – choose/save media.
**Privacy manifest:** `PrivacyInfo.xcprivacy` declaring required-reason APIs (e.g. UserDefaults, file timestamps) – **to be added** before submission.

## Google Play – Data safety
| Question | Answer |
|---|---|
| Does the app collect or share user data? | Collects: name (display name), user IDs (install ID), app activity (days active), app info & performance (version), approximate location (country). Shared with third parties: **none** (Cloudflare processes as service provider). |
| Is data encrypted in transit? | Yes |
| Can users request deletion? | Yes – in-app, and via the /delete-account web page |
| Precise location / contacts / SMS / call logs / audio / photos collected? | No |
**Sensitive permissions:** none of ACCESS_FINE_LOCATION, ACCESS_BACKGROUND_LOCATION, RECORD_AUDIO (blocked in `app.json`), BIND_ACCESSIBILITY_SERVICE, READ_SMS, READ_CALL_LOG, MediaProjection.
**Stalkerware policy:** the app is not a monitoring app; it controls the user's own PC with visible indicators. Any future phone-monitoring feature must meet Play's requirements (persistent notification, clear in-app disclosure, no hiding) or stay disabled.
**Accessibility API:** not used. **Background location:** not used.

## Review notes (for reviewers)
FRISTY Remote lets a user control their own Windows PC from their phone. A pairing must be approved on the PC; the PC shows an indicator during screen viewing/input. The owner service only stores the display name the user types, device type, version and country. Demo: [provide a test PC / video at submission time].
