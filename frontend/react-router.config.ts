import { normalizeBase } from './base-path.mjs';
import type { Config } from '@react-router/dev/config';
export default {
  ssr: true,
  routeDiscovery: { mode: 'initial' },
  basename: `${normalizeBase(process.env.APP_BASE_PATH)}/`,
} satisfies Config;
