import { normalizeBase } from './base-path.mjs';
import { defineConfig } from 'vite';
import { reactRouter } from '@react-router/dev/vite';
export default defineConfig({
  base: `${normalizeBase(process.env.APP_BASE_PATH)}/`,
  plugins: [reactRouter()],
  server: {
    port: Number(process.env.FRONTEND_DEV_PORT ?? 5173),
    strictPort: true,
    proxy: { '/lastochka/api': process.env.DEV_BACKEND_ORIGIN ?? 'http://127.0.0.1:8080' },
  },
});
