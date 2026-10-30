// Shared by Vite, React Router config and the standalone SSR server.
export function normalizeBase(value = '/lastochka') {
  const path = value.replace(/\/+$/, '');
  if (path && !/^\/[a-zA-Z0-9/_-]+$/.test(path)) throw new Error('Invalid APP_BASE_PATH');
  return path;
}
