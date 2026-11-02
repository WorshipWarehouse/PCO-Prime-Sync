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

export default defineConfig({
  plugins: [react()],
  root: 'client',
  publicDir: false,
  build: {
    outDir: '../dist/client',
    emptyOutDir: true,
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
