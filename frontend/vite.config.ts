import { normalizeBase } from './base-path.mjs';
import { defineConfig } from 'vite';
import { reactRouter } from '@react-router/dev/vite';
const base = normalizeBase(process.env.APP_BASE_PATH);
export default defineConfig({
  base: `${base}/`,
  plugins: [reactRouter()],
  server: {
    port: Number(process.env.FRONTEND_DEV_PORT ?? 5173),
    strictPort: true,
    proxy: { [`${base}/api`]: process.env.DEV_BACKEND_ORIGIN ?? 'http://127.0.0.1:8080' },
  },
});
