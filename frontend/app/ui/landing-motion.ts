import { useEffect, useLayoutEffect, useRef } from 'react';

const REDUCED = '(prefers-reduced-motion: reduce)';

/**
 * Hides elements that are still below the screen and shows each of them once. Anything already
 * visible or above stays as rendered, so nothing blinks and nothing can remain hidden.
 */
export function revealOnce(elements: Iterable<HTMLElement>) {
  const waiting = [...elements].filter(
    (el) => !el.dataset.reveal && el.getBoundingClientRect().top > innerHeight,
  );
  const show = (el: HTMLElement) => {
    el.dataset.reveal = 'shown';
    observer.unobserve(el);
  };
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) if (entry.isIntersecting) show(entry.target as HTMLElement);
    },
    // The area above the screen counts as seen: an anchor jump must not leave gaps behind.
    { rootMargin: '1000000px 0px -12% 0px' },
  );
  const focus = (event: FocusEvent) => {
    for (const el of waiting) if (el.contains(event.target as Node)) show(el);
  };
  for (const el of waiting) {
    el.dataset.reveal = 'waiting';
    observer.observe(el);
  }
  document.addEventListener('focusin', focus);
  return () => {
    observer.disconnect();
    document.removeEventListener('focusin', focus);
    // A remount may arm the same elements again, so leave them as rendered.
    for (const el of waiting) if (el.dataset.reveal === 'waiting') delete el.dataset.reveal;
  };
}

function updateSteps(boxes: DOMRect[], markers: HTMLElement[], height: number, still: boolean) {
  let column = 0;
  let previousDistance = 0;
  boxes.forEach((box, index) => {
    const previous = boxes[index - 1];
    const sameRow = Boolean(previous && Math.abs(box.top - previous.top) < 1);
    column = sameRow ? column + 1 : 0;
    const distance = box.top + box.height / 2 - height * (0.8 - column * 0.15);
    // Each incoming stroke finishes exactly when its badge lights up.
    const interval = previous ? distance - previousDistance : height * 0.12;
    const fill = Math.max(0, Math.min(1, 1 - distance / Math.max(1, interval)));
    const length = previous
      ? (sameRow ? box.left - previous.right : box.top - previous.bottom) + 2
      : Math.min(24, box.left);
    const marker = markers[index];
    marker.style.setProperty('--line-length', Math.max(0, length) + 'px');
    marker.style.setProperty('--line-fill', String(fill));
    const article = marker.parentElement!;
    const lit = String(still || fill === 1);
    if (article.dataset.lit !== lit) article.dataset.lit = lit;
    previousDistance = distance;
  });
}

export function useLandingMotion(revision: number) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    return revealOnce(
      root.querySelectorAll<HTMLElement>(
        'h2, .ages-art, .landing-formats-list article, .landing-price-list article',
      ),
    );
  }, [revision]);

  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    const groups = [...root.querySelectorAll('.approach-grid')].map((grid) => [
      ...grid.querySelectorAll<HTMLElement>('.number'),
    ]);
    const words = [...root.querySelectorAll<HTMLElement>('.landing-coach-note > span')];
    const photo = root.querySelector<HTMLElement>('.landing-hero-photo');
    const media = matchMedia(REDUCED);
    let frame = 0;

    const update = () => {
      frame = 0;
      const still = media.matches;
      const height = innerHeight;
      const layouts = groups.map((markers) =>
        markers.map((marker) => marker.getBoundingClientRect()),
      );
      const wordsTop = words[0]?.getBoundingClientRect().top ?? 0;
      const atEnd = scrollY + height >= document.documentElement.scrollHeight - 2;
      const read = atEnd || still ? 1 : (height * 0.84 - wordsTop) / (height * 0.34);

      layouts.forEach((boxes, index) => updateSteps(boxes, groups[index], height, still));
      words.forEach((word, i) => {
        const dim = String(read * words.length <= i);
        if (word.dataset.dim !== dim) word.dataset.dim = dim;
      });
      const enhanced = String(!still);
      if (root.dataset.enhanced !== enhanced) root.dataset.enhanced = enhanced;
    };

    function scheduleUpdate() {
      if (!frame && !document.hidden) frame = requestAnimationFrame(update);
    }
    function pointer(event: PointerEvent) {
      if (event.pointerType !== 'mouse' || media.matches || scrollY > innerHeight) return;
      photo?.style.setProperty('--tilt-x', ((event.clientX / innerWidth) * 2 - 1).toFixed(3));
      photo?.style.setProperty('--tilt-y', ((event.clientY / innerHeight) * 2 - 1).toFixed(3));
    }

    const resize = new ResizeObserver(scheduleUpdate);
    for (const section of root.querySelectorAll(':scope > section')) resize.observe(section);
    const listeners = new AbortController();
    const options = { passive: true, signal: listeners.signal };
    window.addEventListener('scroll', scheduleUpdate, options);
    window.addEventListener('resize', scheduleUpdate, options);
    window.addEventListener('pageshow', scheduleUpdate, options);
    window.addEventListener('pointermove', pointer, options);
    document.addEventListener('visibilitychange', scheduleUpdate, options);
    media.addEventListener('change', scheduleUpdate, options);
    update();
    return () => {
      listeners.abort();
      resize.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [revision]);
  return ref;
}
