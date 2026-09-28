import { svelte } from '@sveltejs/vite-plugin-svelte';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  root: 'web',
  plugins: [svelte()],
  resolve: {
    alias: { $shared: fileURLToPath(new URL('./src/shared', import.meta.url)) },
  },
  build: { outDir: '../dist/web', emptyOutDir: true },
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: { '/api': { target: 'http://127.0.0.1:7717', changeOrigin: false } },
  },
});
