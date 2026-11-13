// Keep the old shared-host build and the root-domain build consistent.
export function appPath(path: string): string {
  return `${import.meta.env.BASE_URL.replace(/\/$/, '')}${path}`;
}

export function currentApiPath(path: string): string {
  const unprefixed = path.startsWith('/lastochka/api/') ? path.slice('/lastochka'.length) : path;
  return unprefixed.startsWith('/api/') ? appPath(unprefixed) : path;
}
