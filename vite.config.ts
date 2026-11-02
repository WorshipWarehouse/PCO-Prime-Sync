import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const apiPort = Number(process.env.PORT ?? 5178);

// Optional, deployment-specific host allowlist (values come from the
// environment, never from tracked files). Vite also honours
// __VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS; this makes the intent explicit.
const allowedHosts = (process.env.VITE_ALLOWED_HOSTS ?? '')
  .split(',')
  .map((host) => host.trim())
  .filter(Boolean);

// Safari is the strict one: pin every transform path (dev, dependency
// pre-bundling and the production bundle) to syntax Safari has supported for
// years, so an older WebKit cannot reject the bundle and leave a blank page.
const browserTarget = ['safari15', 'chrome104', 'firefox104', 'edge104'];

export default defineConfig({
  plugins: [react()],
  root: 'client',
  publicDir: false,
  esbuild: { target: 'safari15' },
  optimizeDeps: { esbuildOptions: { target: 'safari15' } },
  build: {
    outDir: '../dist/client',
    emptyOutDir: true,
    target: browserTarget,
  },
  server: {
    port: Number(process.env.VITE_PORT ?? 3000),
    host: true,
    strictPort: false,
    ...(allowedHosts.length > 0 ? { allowedHosts } : {}),
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${apiPort}`,
        changeOrigin: false,
      },
    },
  },
});
