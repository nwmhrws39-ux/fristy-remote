// One-command setup of the FRISTY owner service from your own computer.
//
//   cd apps/admin-server
//   npx wrangler login        (approve in the browser that opens)
//   node setup.mjs
//
// Creates the free D1 database (first time only), applies the schema, deploys
// the worker, then asks you to type your admin code (hidden; it is stored as a
// Cloudflare secret and never written to disk or sent anywhere else).
import { execSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';

const run = (cmd, opts = {}) => execSync(cmd, { encoding: 'utf8', stdio: ['inherit', 'pipe', 'inherit'], ...opts });
const step = (m) => console.log(`\n▶ ${m}`);

step('Checking Cloudflare login');
try {
  run('npx wrangler whoami');
} catch {
  console.error('Not logged in. Run "npx wrangler login" first.');
  process.exit(1);
}

const findId = () => {
  const list = JSON.parse(run('npx wrangler d1 list --json'));
  const db = list.find((d) => d.name === 'fristy-admin');
  return db ? db.uuid || db.database_id : null;
};

step('Database');
let id = findId();
if (!id) {
  run('npx wrangler d1 create fristy-admin');
  id = findId();
}
if (!id) {
  console.error('Could not create the D1 database.');
  process.exit(1);
}
fs.writeFileSync('wrangler.toml', fs.readFileSync('wrangler.toml.template', 'utf8').replace('__DATABASE_ID__', id));
run('npx wrangler d1 execute fristy-admin --remote --file schema.sql -y');

step('Deploying');
const out = run('npx wrangler deploy');
const url = (out.match(/https:\/\/[a-zA-Z0-9.-]+\.workers\.dev/) || [])[0];

step('Admin code – type your secret code and press Enter (it is not shown)');
const r = spawnSync('npx wrangler secret put ADMIN_CODE', { stdio: 'inherit', shell: true });
if (r.status !== 0) {
  console.error('Setting the admin code failed. Run "npx wrangler secret put ADMIN_CODE" again.');
  process.exit(1);
}

console.log('\n✅ Done.');
console.log(url ? `Your server address:  ${url}\nSend this address (NOT your code) to finish the setup.` : 'Deployed. Copy the workers.dev address shown above.');
