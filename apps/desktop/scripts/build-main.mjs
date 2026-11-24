// Bundles the Electron main + preload processes (including the TypeScript
// workspace packages) into dist/, and copies the sql.js WebAssembly binary.
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const production = process.argv.includes('--production');
const out = path.resolve('dist');

const common = {
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  sourcemap: production ? false : 'inline',
  minify: production,
  external: ['electron', 'bufferutil', 'utf-8-validate', 'osx-temperature-sensor'],
  logLevel: 'info',
  define: { 'process.env.NODE_ENV': JSON.stringify(production ? 'production' : 'development') }
};

await build({ ...common, entryPoints: ['src/main/index.ts'], outfile: path.join(out, 'main', 'index.js') });
await build({ ...common, entryPoints: ['src/preload/index.ts'], outfile: path.join(out, 'preload', 'index.js') });

const wasm = path.join(path.dirname(require.resolve('sql.js')), 'sql-wasm.wasm');
fs.copyFileSync(wasm, path.join(out, 'main', 'sql-wasm.wasm'));
console.log('main/preload bundled');
