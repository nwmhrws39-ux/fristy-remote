import { DEFAULT_ADMIN_API_URL } from './owner-config';

/**
 * Version of the legal document set (Terms, EULA, AUP, Privacy Policy).
 * Bump it on any material change: both apps then ask for acceptance again.
 * Keep in sync with the `version:` front matter of the documents in /legal (a test checks).
 */
export const LEGAL_VERSION = '0.1-draft';

export type LegalDocId =
  | 'privacy'
  | 'terms'
  | 'eula'
  | 'acceptable-use'
  | 'security'
  | 'location-privacy'
  | 'cookies'
  | 'refunds'
  | 'licenses'
  | 'children'
  | 'retention'
  | 'deletion'
  | 'vulnerability'
  | 'accessibility';

/** Public documents and the legal-website path each is served at. */
export const LEGAL_DOCS: { id: LegalDocId; file: string; en: string; he: string }[] = [
  { id: 'terms', file: 'TERMS_OF_SERVICE.md', en: 'Terms of Service', he: 'תנאי שימוש' },
  { id: 'privacy', file: 'PRIVACY_POLICY.md', en: 'Privacy Policy', he: 'מדיניות פרטיות' },
  { id: 'eula', file: 'END_USER_LICENSE_AGREEMENT.md', en: 'License Agreement (EULA)', he: 'הסכם רישיון' },
  { id: 'acceptable-use', file: 'ACCEPTABLE_USE_POLICY.md', en: 'Acceptable Use Policy', he: 'מדיניות שימוש מותר' },
  { id: 'security', file: 'SECURITY_POLICY.md', en: 'Security', he: 'אבטחה' },
  { id: 'location-privacy', file: 'LOCATION_PRIVACY_POLICY.md', en: 'Location Privacy', he: 'פרטיות מיקום' },
  { id: 'retention', file: 'DATA_RETENTION_POLICY.md', en: 'Data Retention', he: 'שמירת מידע' },
  { id: 'deletion', file: 'DATA_DELETION_POLICY.md', en: 'Data Deletion', he: 'מחיקת מידע' },
  { id: 'children', file: 'CHILD_PRIVACY_POLICY.md', en: "Children's Privacy", he: 'פרטיות ילדים' },
  { id: 'cookies', file: 'COOKIE_POLICY.md', en: 'Cookies', he: 'עוגיות' },
  { id: 'refunds', file: 'REFUND_POLICY.md', en: 'Refunds', he: 'החזרים' },
  { id: 'licenses', file: 'THIRD_PARTY_LICENSES.md', en: 'Open-source licenses', he: 'רישיונות קוד פתוח' },
  { id: 'vulnerability', file: 'VULNERABILITY_DISCLOSURE.md', en: 'Report a vulnerability', he: 'דיווח על חולשה' },
  { id: 'accessibility', file: 'ACCESSIBILITY_STATEMENT.md', en: 'Accessibility', he: 'נגישות' }
];

/** Documents the user must accept (contract) vs. read (notice). */
export const LEGAL_CONTRACT_DOCS: LegalDocId[] = ['terms', 'eula', 'acceptable-use'];
export const LEGAL_NOTICE_DOCS: LegalDocId[] = ['privacy'];

/** The legal website is served by the owner service. */
export function legalUrl(page: LegalDocId | 'delete-account' | 'report-abuse' | 'contact', lang: 'en' | 'he' = 'en', base = DEFAULT_ADMIN_API_URL): string {
  return `${base.replace(/\/+$/, '')}/${page}${lang === 'he' ? '?lang=he' : ''}`;
}

export interface LegalAcceptance {
  version: string;
  acceptedAt: number;
  /** confirmed 18+ (eligibility statement, not parental consent) */
  adult: true;
  /** contract documents accepted with this version */
  documents: LegalDocId[];
}

export function isAccepted(a: LegalAcceptance | null | undefined): boolean {
  return !!a && a.version === LEGAL_VERSION && a.adult === true;
}

/** Categories of the abuse / security report form (must match the owner service). */
export const REPORT_CATEGORIES = ['unauthorized-access', 'unauthorized-tracking', 'account-compromise', 'vulnerability', 'other'] as const;
export type ReportCategory = (typeof REPORT_CATEGORIES)[number];
