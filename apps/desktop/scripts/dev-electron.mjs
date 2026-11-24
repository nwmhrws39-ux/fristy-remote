// Starts Electron against the Vite dev server once it is reachable.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import http from 'node:http';

const require = createRequire(import.meta.url);
const url = 'http://localhost:5173';
const wait = () =>
  new Promise((resolve) => {
    const tryOnce = () => http.get(url, () => resolve()).on('error', () => setTimeout(tryOnce, 300));
    tryOnce();
  });

await wait();
const child = spawn(require('electron'), ['.'], { stdio: 'inherit', env: { ...process.env, FRISTY_DEV_URL: url } });
child.on('exit', (code) => process.exit(code ?? 0));
