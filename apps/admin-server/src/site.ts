import { LEGAL_PAGES } from './legal-pages';

/*
 * The FRISTY Remote legal website, served by the owner service.
 * Plain HTML: no JavaScript, no cookies, no external resources, no tracking.
 * Language is chosen with ?lang=he (RTL) – nothing is stored.
 */

export type Lang = 'en' | 'he';

const NAV: { id: string; en: string; he: string }[] = [
  { id: 'privacy', en: 'Privacy', he: 'פרטיות' },
  { id: 'terms', en: 'Terms', he: 'תנאי שימוש' },
  { id: 'eula', en: 'EULA', he: 'רישיון' },
  { id: 'acceptable-use', en: 'Acceptable use', he: 'שימוש מותר' },
  { id: 'security', en: 'Security', he: 'אבטחה' },
  { id: 'location-privacy', en: 'Location', he: 'מיקום' },
  { id: 'retention', en: 'Retention', he: 'שמירת מידע' },
  { id: 'deletion', en: 'Deletion', he: 'מחיקה' },
  { id: 'children', en: 'Children', he: 'ילדים' },
  { id: 'cookies', en: 'Cookies', he: 'עוגיות' },
  { id: 'refunds', en: 'Refunds', he: 'החזרים' },
  { id: 'licenses', en: 'Licenses', he: 'רישיונות' },
  { id: 'vulnerability', en: 'Vulnerabilities', he: 'חולשות' },
  { id: 'accessibility', en: 'Accessibility', he: 'נגישות' },
  { id: 'delete-account', en: 'Delete data', he: 'מחיקת מידע' },
  { id: 'report-abuse', en: 'Report abuse', he: 'דיווח' },
  { id: 'contact', en: 'Contact', he: 'צור קשר' }
];

/** Aliases for the URLs listed in the documents. */
const ALIASES: Record<string, string> = { cookie: 'cookies', refund: 'refunds', 'third-party-licenses': 'licenses', 'location': 'location-privacy' };

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const CSS = `
:root{--bg:#07070b;--card:#111119;--line:#24243a;--fg:#ececf4;--muted:#a3a3bb;--accent:#8b5cf6;--accent2:#6d28d9;--warn:#f5b84b}
@media (prefers-color-scheme:light){:root{--bg:#f7f7fb;--card:#fff;--line:#e3e3ef;--fg:#16161f;--muted:#5b5b70;--accent:#6d28d9;--accent2:#5b21b6;--warn:#9a6200}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.65 "Segoe UI",system-ui,-apple-system,"Noto Sans Hebrew",sans-serif}
a{color:var(--accent)}header{border-bottom:1px solid var(--line);background:var(--card)}
.bar{max-width:980px;margin:auto;padding:14px 20px;display:flex;gap:16px;align-items:center;justify-content:space-between;flex-wrap:wrap}
.logo{display:flex;align-items:center;gap:10px;font-weight:800;letter-spacing:.18em;color:var(--fg);text-decoration:none}
.logo b{display:grid;place-items:center;width:34px;height:34px;border-radius:10px;background:linear-gradient(135deg,var(--accent),var(--accent2));color:#fff;letter-spacing:0}
nav{max-width:980px;margin:auto;padding:0 20px 12px;display:flex;flex-wrap:wrap;gap:6px}
nav a{font-size:13px;text-decoration:none;color:var(--muted);padding:4px 10px;border-radius:99px;border:1px solid var(--line)}
nav a[aria-current]{background:var(--accent);border-color:var(--accent);color:#fff}
main{max-width:980px;margin:auto;padding:28px 20px 60px}
h1{font-size:30px;margin:0 0 6px}h2{margin-top:34px;font-size:22px}h3{font-size:18px}
.meta{color:var(--muted);font-size:13px;margin-bottom:18px}
blockquote{margin:16px 0;padding:12px 16px;border-inline-start:4px solid var(--warn);background:color-mix(in srgb,var(--warn) 10%,transparent);border-radius:10px}
.t{overflow-x:auto;margin:14px 0}table{border-collapse:collapse;width:100%;font-size:14px}th,td{border:1px solid var(--line);padding:7px 9px;text-align:start;vertical-align:top}th{background:var(--card)}
pre{background:var(--card);border:1px solid var(--line);padding:12px;border-radius:10px;overflow-x:auto;font-size:13px}code{background:var(--card);padding:1px 5px;border-radius:5px}
.card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:20px;margin:16px 0}
label{display:block;font-weight:600;margin:14px 0 6px}select,textarea,input{width:100%;font:inherit;color:var(--fg);background:var(--bg);border:1px solid var(--line);border-radius:10px;padding:10px}
button{margin-top:16px;font:inherit;font-weight:700;color:#fff;background:linear-gradient(135deg,var(--accent),var(--accent2));border:0;border-radius:12px;padding:11px 20px;cursor:pointer}
footer{border-top:1px solid var(--line);color:var(--muted);font-size:13px}footer .bar{justify-content:center}
.ok{color:#22c55e;font-weight:700}.err{color:#ef4444;font-weight:700}
@media (max-width:600px){h1{font-size:24px}main{padding:20px 16px 48px}}
`;

function layout(lang: Lang, current: string, title: string, body: string): string {
  const rtl = lang === 'he';
  const q = (id: string, l: Lang = lang) => `/${id}${l === 'he' ? '?lang=he' : ''}`;
  const nav = NAV.map((n) => `<a href="${q(n.id)}"${n.id === current ? ' aria-current="page"' : ''}>${rtl ? n.he : n.en}</a>`).join('');
  return `<!doctype html><html lang="${lang}" dir="${rtl ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)} – FRISTY Remote</title><style>${CSS}</style></head><body>
<header><div class="bar"><a class="logo" href="${q('legal')}"><b>F</b>FRISTY REMOTE</a><a href="${q(current, rtl ? 'en' : 'he')}" hreflang="${rtl ? 'en' : 'he'}">${rtl ? 'English' : 'עברית'}</a></div><nav aria-label="${rtl ? 'מסמכים' : 'Documents'}">${nav}</nav></header>
<main>${body}</main>
<footer><div class="bar">${rtl ? 'טיוטות – ממתינות לבדיקה משפטית · ללא עוגיות וללא מעקב' : 'Drafts pending legal review · no cookies, no tracking'}</div></footer></body></html>`;
}

function html(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer'
    }
  });
}

const CATEGORIES: { id: string; en: string; he: string }[] = [
  { id: 'unauthorized-access', en: 'Unauthorized remote access', he: 'גישה מרחוק לא מורשית' },
  { id: 'unauthorized-tracking', en: 'Unauthorized tracking', he: 'מעקב לא מורשה' },
  { id: 'account-compromise', en: 'My device or code was compromised', he: 'המכשיר או הקוד שלי נפרצו' },
  { id: 'vulnerability', en: 'Security vulnerability', he: 'חולשת אבטחה' },
  { id: 'other', en: 'Other / data request (access, correction, deletion)', he: 'אחר / בקשת מידע (עיון, תיקון, מחיקה)' }
];

function reportPage(lang: Lang, result?: 'ok' | string): string {
  const he = lang === 'he';
  const status = result === 'ok' ? `<p class="ok">${he ? 'הדיווח נשלח. תודה.' : 'Report sent. Thank you.'}</p>` : result ? `<p class="err">${esc(result)}</p>` : '';
  return `<h1>${he ? 'דיווח על שימוש לרעה או בעיית אבטחה' : 'Report abuse or a security problem'}</h1>
<p>${he ? 'דווחו על גישה לא מורשית, מעקב לא מורשה, מכשיר שנפרץ, חולשת אבטחה או בקשת מידע. נשלח רק מה שתכתבו. מומלץ להשתמש בטופס שבתוך האפליקציה, שמצרף את מזהה ההתקנה.' : 'Report unauthorized access, unauthorized tracking, a compromised device, a vulnerability or a data request. Only what you write is sent. The in-app form is preferred because it attaches your installation ID.'}</p>
<p>${he ? '<strong>אם מישהו שולט במחשב שלך עכשיו:</strong> לחצו Ctrl+Alt+Shift+F12 במחשב ובטלו את כל המכשירים ב"פרטיות ואבטחה".' : '<strong>If someone is controlling your PC right now:</strong> press Ctrl+Alt+Shift+F12 on the PC and revoke all devices in Privacy &amp; Security.'}</p>
${status}
<form class="card" method="post" action="/report-abuse${he ? '?lang=he' : ''}">
<label for="category">${he ? 'קטגוריה' : 'Category'}</label><select id="category" name="category">${CATEGORIES.map((c) => `<option value="${c.id}">${he ? c.he : c.en}</option>`).join('')}</select>
<label for="message">${he ? 'מה קרה? (5–1000 תווים)' : 'What happened? (5–1000 characters)'}</label><textarea id="message" name="message" rows="6" minlength="5" maxlength="1000" required></textarea>
<label for="contact">${he ? 'פרטי קשר (לא חובה – רק אם תרצו תשובה)' : 'Contact (optional – only if you want a reply)'}</label><input id="contact" name="contact" maxlength="200" autocomplete="email">
<button type="submit">${he ? 'שליחה' : 'Send report'}</button></form>`;
}

function deleteAccountPage(lang: Lang): string {
  const he = lang === 'he';
  return he
    ? `<h1>מחיקת המידע שלך</h1><p>ב-FRISTY Remote <strong>אין חשבונות משתמש</strong>. כל התקנה מזוהה רק במזהה אקראי, ואפשר למחוק את המידע ישירות מהאפליקציה:</p>
<ol><li><strong>טלפון:</strong> הגדרות ← פרטיות ← "מחק את המידע שלי מהשרת".</li><li><strong>מחשב:</strong> פרטיות ואבטחה ← "מחק את המידע שלי מהשרת".</li><li>הסרת האפליקציה מוחקת את כל המידע המקומי במכשיר.</li></ol>
<div class="card"><p><strong>אין לך יותר את האפליקציה?</strong> שלחו בקשה ב<a href="/report-abuse?lang=he">טופס הדיווח</a> (קטגוריה "אחר / בקשת מידע") עם השם שבו השתמשתם באפליקציה. המפעיל ימחק את הרשומה תוך [30] יום ויאשר אם השארתם פרטי קשר.</p></div>
<p>פירוט מלא: <a href="/deletion?lang=he">מדיניות מחיקת מידע</a> · <a href="/retention?lang=he">מדיניות שמירת מידע</a>.</p>`
    : `<h1>Delete your data</h1><p>FRISTY Remote has <strong>no user accounts</strong>. Each installation is identified only by a random ID, and you can delete its data directly in the app:</p>
<ol><li><strong>Phone:</strong> Settings → Privacy → <em>Delete my data on the server</em>.</li><li><strong>PC:</strong> Privacy &amp; Security → <em>Delete my data on the server</em>.</li><li>Uninstalling the app removes all local data from that device.</li></ol>
<div class="card"><p><strong>No longer have the app?</strong> Send a request with the <a href="/report-abuse">report form</a> (category "Other / data request") including the name you used in the app. The operator deletes the record within [30] days and confirms if you left contact details.</p></div>
<p>Details: <a href="/deletion">Data Deletion Policy</a> · <a href="/retention">Data Retention Policy</a>.</p>`;
}

function contactPage(lang: Lang): string {
  const he = lang === 'he';
  return he
    ? `<h1>צור קשר</h1><div class="card"><p><strong>מפעיל:</strong> [שם משפטי של המפעיל]<br><strong>כתובת:</strong> [כתובת]<br><strong>פרטיות:</strong> [כתובת דוא״ל לפרטיות]</p></div><p>עד שפרטים אלה יושלמו, הדרך לפנות היא <a href="/report-abuse?lang=he">טופס הדיווח</a>.</p>`
    : `<h1>Contact</h1><div class="card"><p><strong>Operator:</strong> [OPERATOR LEGAL NAME]<br><strong>Address:</strong> [ADDRESS]<br><strong>Privacy:</strong> [PRIVACY CONTACT EMAIL]</p></div><p>Until these details are completed, please use the <a href="/report-abuse">report form</a>.</p>`;
}

function indexPage(lang: Lang): string {
  const he = lang === 'he';
  const docs = Object.entries(LEGAL_PAGES)
    .map(([id, p]) => `<li><a href="/${id}${he ? '?lang=he' : ''}">${esc(he ? p.titleHe : p.title)}</a></li>`)
    .join('');
  return `<h1>${he ? 'מסמכים משפטיים' : 'Legal documents'}</h1><blockquote>${he ? 'כל המסמכים הם טיוטות שממתינות לבדיקה של עורך דין מוסמך.' : 'All documents are drafts pending review by a qualified lawyer.'}</blockquote><ul>${docs}</ul>`;
}

export function langOf(url: URL): Lang {
  return url.searchParams.get('lang') === 'he' ? 'he' : 'en';
}

/** Renders a GET page of the legal website, or null when the path is not part of it. */
export function renderSite(url: URL): Response | null {
  const lang = langOf(url);
  const id = ALIASES[url.pathname.slice(1)] ?? url.pathname.slice(1);
  const doc = LEGAL_PAGES[id];
  if (doc) {
    const he = lang === 'he';
    const content = he && doc.he ? doc.he : doc.en;
    const note = he && !doc.he ? '<blockquote>המסמך זמין באנגלית בלבד.</blockquote>' : '';
    const title = he ? doc.titleHe : doc.title;
    const meta = `<div class="meta">${he ? 'גרסה' : 'Version'} ${esc(doc.version)} · ${he ? 'תחילה' : 'Effective'}: ${esc(doc.effective)} · ${he ? 'עודכן' : 'Updated'} ${esc(doc.updated)}</div>`;
    return html(layout(lang, id, title, `<h1>${esc(title)}</h1>${meta}${note}${content}`));
  }
  switch (id) {
    case 'legal':
      return html(layout(lang, 'legal', lang === 'he' ? 'מסמכים משפטיים' : 'Legal', indexPage(lang)));
    case 'delete-account':
      return html(layout(lang, id, lang === 'he' ? 'מחיקת מידע' : 'Delete your data', deleteAccountPage(lang)));
    case 'report-abuse':
      return html(layout(lang, id, lang === 'he' ? 'דיווח' : 'Report abuse', reportPage(lang)));
    case 'contact':
      return html(layout(lang, id, lang === 'he' ? 'צור קשר' : 'Contact', contactPage(lang)));
  }
  return null;
}

/** Result page after the HTML report form was submitted. */
export function reportResult(url: URL, result: 'ok' | string, status: number): Response {
  const lang = langOf(url);
  const r = html(layout(lang, 'report-abuse', lang === 'he' ? 'דיווח' : 'Report abuse', reportPage(lang, result)), status);
  r.headers.set('Cache-Control', 'no-store');
  return r;
}
