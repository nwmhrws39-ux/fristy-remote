# /legal – legal, privacy & compliance (DRAFTS)

All documents are **drafts pending review by a qualified lawyer**. They were written from the actual code and must change together with it.

| Public documents (served at `<owner service>/<path>`, EN + HE) | Internal documents |
|---|---|
| PRIVACY_POLICY (`/privacy`), TERMS_OF_SERVICE (`/terms`), END_USER_LICENSE_AGREEMENT (`/eula`), ACCEPTABLE_USE_POLICY (`/acceptable-use`), SECURITY_POLICY (`/security`), LOCATION_PRIVACY_POLICY (`/location-privacy`), DATA_RETENTION_POLICY (`/retention`), DATA_DELETION_POLICY (`/deletion`), CHILD_PRIVACY_POLICY (`/children`), COOKIE_POLICY (`/cookies`), REFUND_POLICY (`/refunds`), THIRD_PARTY_LICENSES (`/licenses`), VULNERABILITY_DISCLOSURE (`/vulnerability`), ACCESSIBILITY_STATEMENT (`/accessibility`); plus `/delete-account`, `/report-abuse`, `/contact`, `/legal` | COMPLIANCE_MATRIX, PRIVACY_IMPACT_ASSESSMENT, DATA_BREACH_RESPONSE, APP_STORE_DISCLOSURES, COPYRIGHT_NOTICE, **LEGAL_COMPLIANCE_CHECKLIST (release-blocking items)**, `sbom.cdx.json` |

## Changing a document
1. Edit the Markdown (English first, then a `---` line and the Hebrew version starting with `# `).
2. For a **material** change to Terms / EULA / AUP / Privacy Policy: bump `LEGAL_VERSION` in `packages/shared/src/legal.ts` **and** the `version:` front matter of those four files – both apps then ask every user to accept again.
3. Regenerate: `node scripts/build-legal-site.mjs` (website) and `node scripts/sbom.mjs` (after dependency changes). CI fails if they are out of date.
4. Deploy the owner service (`cd apps/admin-server && node setup.mjs --update`) so the website shows the new text.
