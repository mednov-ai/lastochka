import { useLayoutEffect, useRef } from 'react';
const clamp = (value: number) => Math.max(0, Math.min(1, value));
type Progress = { el: HTMLElement; start: number; length: number; last: number };
type Scene = Progress & { numbers: Progress[] };
export function useLandingMotion(revision: number) {
  const ref = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    let scenes: Scene[] = [];
    let frame = 0;
    let needsMeasure = true;
    let disposed = false;
    function update() {
      frame = 0;
      if (disposed) return;
      const y = scrollY;
      if (needsMeasure) {
        // Measure static section frames before writing any styles. Child transforms never feed back.
        scenes = [...root!.querySelectorAll<HTMLElement>('[data-motion]')].map((el) => {
          const rect = el.getBoundingClientRect();
          const top = rect.top + y;
          const hero = el.dataset.motion === 'hero-reveal';
          const numbers: Progress[] = [];
          if (el.dataset.motion === 'approach-story') {
            const header = document.querySelector<HTMLElement>('.header');
            const ceiling =
              header && getComputedStyle(header).position === 'sticky'
                ? header.getBoundingClientRect().height
                : 0;
            for (const article of el.querySelectorAll<HTMLElement>('article')) {
              const anchor = article.querySelector<HTMLElement>('.number');
              if (!anchor) continue;
              const r = anchor.getBoundingClientRect();
              const center = r.top + y + r.height / 2;
              const base = center - innerHeight * 0.85;
              const available = Math.max(1, innerHeight * 0.85 - ceiling - r.height / 2 - 12);
              const gap = Math.min(innerHeight * 0.08, available / 5);
              const length = Math.min(innerHeight * 0.14, available / 2);
              const previous = numbers.at(-1);
              const start = Math.min(
                base + available - length,
                Math.max(base, previous ? previous.start + gap : base),
              );
              numbers.push({ el: article, start, length, last: -1 });
            }
          }
          return {
            el,
            numbers,
            start: hero ? Math.max(0, top - innerHeight * 0.2) : top - innerHeight * 0.75,
            length: hero
              ? Math.max(240, Math.min(rect.height * 0.75, innerHeight * 0.9))
              : Math.max(240, rect.height),
            last: -1,
          };
        });
        needsMeasure = false;
      }
      for (const scene of scenes) {
        let total = 0;
        for (const number of scene.numbers) {
          const p = media.matches ? 1 : clamp((y - number.start) / number.length);
          total += p;
          if (Math.abs(p - number.last) < 0.0001) continue;
          number.el.style.setProperty('--item-progress', p.toFixed(4));
          number.last = p;
        }
        const p = scene.numbers.length
          ? total / scene.numbers.length
          : media.matches
            ? 1
            : clamp((y - scene.start) / scene.length);
        if (Math.abs(p - scene.last) < 0.0001) continue;
        scene.el.style.setProperty('--progress', p.toFixed(4));
        scene.last = p;
      }
      const enhanced = media.matches ? 'false' : 'true';
      if (root!.dataset.enhanced !== enhanced) root!.dataset.enhanced = enhanced;
    }
    function schedule() {
      if (!frame) frame = requestAnimationFrame(update);
    }
    function measure() {
      needsMeasure = true;
      schedule();
    }
    const resize = new ResizeObserver(measure);
    resize.observe(root);
    for (const section of root.querySelectorAll('section')) resize.observe(section);
    root.addEventListener('load', measure, true);
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', measure);
    window.addEventListener('pageshow', measure);
    window.visualViewport?.addEventListener('resize', measure);
    media.addEventListener('change', measure);
    void document.fonts.ready.then(() => {
      if (!disposed) measure();
    });
    update();
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      resize.disconnect();
      root.removeEventListener('load', measure, true);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', measure);
      window.removeEventListener('pageshow', measure);
      window.visualViewport?.removeEventListener('resize', measure);
      media.removeEventListener('change', measure);
    };
  }, [revision]);
  return ref;
}
