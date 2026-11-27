// Builds apps/admin-server/src/legal-pages.ts from the Markdown documents in /legal,
// so the owner service can serve the legal website (/privacy, /terms, …) in English and Hebrew.
// Run: node scripts/build-legal-site.mjs      (a test fails if the output is out of date)
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const legalDir = path.join(root, 'legal');

// Mirrors LEGAL_DOCS in packages/shared/src/legal.ts (a test checks they match).
const DOCS = [
  ['terms', 'TERMS_OF_SERVICE.md'],
  ['privacy', 'PRIVACY_POLICY.md'],
  ['eula', 'END_USER_LICENSE_AGREEMENT.md'],
  ['acceptable-use', 'ACCEPTABLE_USE_POLICY.md'],
  ['security', 'SECURITY_POLICY.md'],
  ['location-privacy', 'LOCATION_PRIVACY_POLICY.md'],
  ['retention', 'DATA_RETENTION_POLICY.md'],
  ['deletion', 'DATA_DELETION_POLICY.md'],
  ['children', 'CHILD_PRIVACY_POLICY.md'],
  ['cookies', 'COOKIE_POLICY.md'],
  ['refunds', 'REFUND_POLICY.md'],
  ['licenses', 'THIRD_PARTY_LICENSES.md'],
  ['vulnerability', 'VULNERABILITY_DISCLOSURE.md'],
  ['accessibility', 'ACCESSIBILITY_STATEMENT.md']
];
const fileToPath = Object.fromEntries(DOCS.map(([id, f]) => [f, `/${id}`]));

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function inline(s) {
  let out = esc(s);
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(^|[\s(])\*([^*\s][^*]*?)\*(?=[\s).,;:]|$)/g, '$1<em>$2</em>');
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, text, href) => {
    const target = fileToPath[href.replace(/^\.\//, '')] ?? (/^https:\/\//.test(href) ? href : null);
    return target ? `<a href="${target}">${text}</a>` : text;
  });
  return out;
}

/** Small, safe Markdown subset: headings, paragraphs, lists, tables, quotes, code blocks. */
export function markdown(md) {
  const lines = md.split('\n');
  const html = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^```/.test(line)) {
      const buf = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
      i++;
      html.push(`<pre>${esc(buf.join('\n'))}</pre>`);
      continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      const n = Math.min(h[1].length + 1, 4); // page title is the <h1>
      html.push(`<h${n}>${inline(h[2])}</h${n}>`);
      i++;
      continue;
    }
    if (/^\|/.test(line)) {
      const rows = [];
      while (i < lines.length && /^\|/.test(lines[i])) rows.push(lines[i++]);
      const cells = (r) => r.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const body = rows.filter((r, k) => !(k === 1 && /^\|[\s:|-]+\|$/.test(r)));
      const [head, ...rest] = body;
      html.push(
        `<div class="t"><table><thead><tr>${cells(head).map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${rest
          .map((r) => `<tr>${cells(r).map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`)
          .join('')}</tbody></table></div>`
      );
      continue;
    }
    if (/^>\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, ''));
      html.push(`<blockquote>${inline(buf.join(' '))}</blockquote>`);
      continue;
    }
    if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items = [];
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*([-*]|\d+\.)\s+/, ''));
      html.push(`<${ordered ? 'ol' : 'ul'}>${items.map((x) => `<li>${inline(x)}</li>`).join('')}</${ordered ? 'ol' : 'ul'}>`);
      continue;
    }
    if (!line.trim() || /^---$/.test(line.trim())) {
      i++;
      continue;
    }
    const buf = [];
    while (i < lines.length && lines[i].trim() && !/^(#|\||>|```|\s*([-*]|\d+\.)\s)/.test(lines[i]) && lines[i].trim() !== '---') buf.push(lines[i++]);
    html.push(`<p>${inline(buf.join(' '))}</p>`);
  }
  return html.join('\n');
}

function parse(file) {
  const raw = fs.readFileSync(path.join(legalDir, file), 'utf8');
  const fm = /^---\n([\s\S]*?)\n---\n/.exec(raw);
  const meta = {};
  if (fm) for (const l of fm[1].split('\n')) { const m = /^(\w+):\s*(.*)$/.exec(l); if (m) meta[m[1]] = m[2]; }
  const body = fm ? raw.slice(fm[0].length) : raw;
  // English first; the Hebrew version follows a "---" line and starts with a "# " heading.
  const split = body.search(/\n---\n\n# /);
  const en = split >= 0 ? body.slice(0, split) : body;
  const he = split >= 0 ? body.slice(split + 5) : null;
  const strip = (s) => s.replace(/^# .*\n/m, ''); // the first H1 becomes the page title
  return {
    title: meta.title ?? file,
    titleHe: meta.title_he ?? meta.title ?? file,
    version: meta.version ?? '',
    effective: meta.effective ?? '',
    updated: meta.updated ?? '',
    en: markdown(strip(en)),
    he: he ? markdown(strip(he)) : null
  };
}

const pages = {};
for (const [id, file] of DOCS) pages[id] = parse(file);

const out = `// Generated by scripts/build-legal-site.mjs from /legal – do not edit by hand.
export interface LegalPage {
  title: string;
  titleHe: string;
  version: string;
  effective: string;
  updated: string;
  en: string;
  he: string | null;
}

export const LEGAL_PAGES: Record<string, LegalPage> = ${JSON.stringify(pages, null, 0)};
`;
fs.writeFileSync(path.join(root, 'apps', 'admin-server', 'src', 'legal-pages.ts'), out);
console.log(`legal site: ${Object.keys(pages).length} documents`);
