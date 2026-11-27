// Runs in the document head, before React Router restores the initial scroll position.
// WebKit may follow the fragment again between DOMContentLoaded and pageshow.
(() => {
  if (
    document.readyState !== 'loading' ||
    performance.getEntriesByType('navigation')[0]?.type !== 'reload'
  )
    return;
  let position;
  try {
    const positions = JSON.parse(
      sessionStorage.getItem(document.currentScript.dataset.storageKey) ?? '{}',
    );
    position = positions[history.state?.key ?? 'default'];
  } catch {
    return;
  }
  if (!Number.isFinite(position)) return;

  history.scrollRestoration = 'manual';
  const controller = new AbortController();
  const options = { passive: true, signal: controller.signal };
  const stop = () => controller.abort();
  const restore = () => {
    if (!controller.signal.aborted && scrollY !== position) scrollTo(0, position);
  };
  for (const event of [
    'pointerdown',
    'touchstart',
    'wheel',
    'keydown',
    'popstate',
    'hashchange',
    'pagehide',
  ])
    window.addEventListener(event, stop, options);
  window.addEventListener('scroll', restore, options);
  window.addEventListener(
    'pageshow',
    () =>
      requestAnimationFrame(() => {
        restore();
        stop();
      }),
    { ...options, once: true },
  );
})();
