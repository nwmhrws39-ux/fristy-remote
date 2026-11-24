import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  root: path.resolve(__dirname, 'src/renderer'),
  base: './',
  plugins: [react(), tailwindcss()],
  server: { port: 5173, strictPort: true },
  build: {
    outDir: path.resolve(__dirname, 'dist/renderer'),
    emptyOutDir: true,
    target: 'chrome130',
    rollupOptions: {
      input: {
        index: path.resolve(__dirname, 'src/renderer/index.html'),
        indicator: path.resolve(__dirname, 'src/renderer/indicator.html')
      }
    }
  }
});
