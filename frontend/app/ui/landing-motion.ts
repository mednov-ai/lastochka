import { useEffect, useLayoutEffect, useRef } from 'react';
import { privacyClosedEvent } from './privacy-consent';
import {
  buildRoute,
  collectBoxes,
  lengthAt,
  ribbonAlpha,
  ribbonColors,
  ribbonSway,
  ribbonWidth,
  type Route,
} from './landing-route';

const CALM_AFTER_MS = 3000;
const INTRO_SECONDS = 2.4;
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

export function useLandingMotion(revision: number) {
  const ref = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    return revealOnce(
      root.querySelectorAll<HTMLElement>(
        'h2, .ages-art, .landing-formats-list article, .landing-price-list article, .landing-coach-photo',
      ),
    );
  }, [revision]);

  useLayoutEffect(() => {
    const main = ref.current;
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!main || !canvas || !context) return;
    const root: HTMLElement = main;
    const surface: HTMLCanvasElement = canvas;
    const ctx: CanvasRenderingContext2D = context;
    const media = matchMedia(REDUCED);
    let route: Route | null = null;
    let markers: HTMLElement[] = [];
    let words: HTMLElement[] = [];
    let origin = 0;
    let length = 0;
    let frame = 0;
    let last = 0;
    let touched = performance.now();
    let clock = 0;
    let intro = 0;
    let head = 0;
    let speed = 0;
    let activity = 1;
    let dirty = true;
    let disposed = false;

    function measure() {
      dirty = false;
      const boxes = collectBoxes(root);
      origin = root.getBoundingClientRect().top + scrollY;
      boxes.sections = boxes.sections.filter((s) => s.box.b - s.box.t > 1);
      route = buildRoute(boxes);
      markers = [...root.querySelectorAll<HTMLElement>('.approach-grid article')];
      words = [...root.querySelectorAll<HTMLElement>('.landing-coach-note > span')];
      const ratio = Math.min(2, devicePixelRatio);
      length = root.offsetHeight;
      const height = Math.min(length, Math.round(boxes.viewport * 1.8));
      const pixels = [Math.round(boxes.width * ratio), Math.round(height * ratio)];
      if (surface.width !== pixels[0] || surface.height !== pixels[1]) {
        [surface.width, surface.height] = pixels;
        surface.style.width = `${boxes.width}px`;
        surface.style.height = `${height}px`;
      }
    }

    function update(now: number) {
      frame = 0;
      if (disposed) return;
      if (dirty) measure();
      const still = media.matches;
      // All layout reads come before the writes below.
      const covered = !!document.querySelector('.privacy-consent[open]');
      const wordsTop = words.length ? words[0].getBoundingClientRect().top : 0;
      const atEnd = scrollY + innerHeight >= document.documentElement.scrollHeight - 2;
      const delta = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60;
      last = now;
      if (route) {
        if (still) {
          head = route.total;
          speed = 0;
          activity = 0;
        } else if (covered) {
          // The introduction starts over once the visitor can actually see it.
          intro = 0;
          head = 0;
          speed = 0;
          activity = 1;
        } else {
          intro = Math.min(1, intro + delta / INTRO_SECONDS);
          const opening = route.intro * (1 - Math.pow(1 - intro, 3));
          const goal = scrollY < 4 ? opening : Math.max(opening, lengthAt(route, scrollY - origin));
          const before = head;
          head += (goal - head) * (1 - Math.exp(-delta * 5));
          if (Math.abs(goal - head) < 0.5) head = goal;
          speed += ((head - before) / delta - speed) * 0.12;
          const calm = intro === 1 && now - touched > CALM_AFTER_MS;
          activity += ((calm ? 0 : 1) - activity) * (1 - Math.exp(-delta * 2.5));
          clock += delta * activity;
        }
        const reached = route.markers;
        markers.forEach((el, i) => {
          const lit = String(i < reached.length && head >= reached[i] - 10);
          if (el.dataset.lit !== lit) el.dataset.lit = lit;
        });
        draw(route, still);
      }
      if (words.length) {
        const read = atEnd || still ? 1 : (innerHeight * 0.84 - wordsTop) / (innerHeight * 0.34);
        words.forEach((el, i) => {
          const dim = String(read * words.length <= i);
          if (el.dataset.dim !== dim) el.dataset.dim = dim;
        });
      }
      const enhanced = still ? 'false' : 'true';
      if (root.dataset.enhanced !== enhanced) root.dataset.enhanced = enhanced;
      const calm = activity < 0.02 && Math.abs(speed) < 2;
      if (!still && !covered && route && !calm && !document.hidden)
        frame = requestAnimationFrame(update);
    }

    function draw(path: Route, still: boolean) {
      const ratio = surface.width / (parseFloat(surface.style.width) || 1);
      const height = surface.height / ratio;
      const top = Math.max(0, Math.min(length - height, scrollY - origin - innerHeight * 0.4));
      // The canvas sits in document coordinates, so native scrolling never outruns it.
      surface.style.top = `${top}px`;
      ctx.setTransform(ratio, 0, 0, ratio, 0, -top * ratio);
      ctx.clearRect(0, top, surface.width, height);
      const full = ribbonWidth(path.mobile);
      const sway = ribbonSway(path.mobile);
      const rush = Math.min(1, Math.abs(speed) / 1400);
      let run: [number, number, number, number][] = [];
      let side = 0;
      let tone = 1;
      const flush = () => {
        if (run.length > 1) {
          ctx.beginPath();
          run.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
          for (let i = run.length - 1; i >= 0; i--) ctx.lineTo(run[i][2], run[i][3]);
          ctx.closePath();
          ctx.fillStyle = ribbonColors[side > 0 ? 0 : 1];
          ctx.globalAlpha = ribbonAlpha(path.mobile, tone);
          ctx.fill();
        }
        run = [];
      };
      let x = 0;
      let y = 0;
      let angle = 0;
      let clear = 0;
      let drawn = false;
      for (const p of path.points) {
        if (p.length > head) break;
        const rest = head - p.length;
        const wave =
          Math.sin(p.length / 150 - clock * 1.5) * sway +
          Math.exp(-rest / 220) * rush * sway * 2 * Math.sin(p.length / 55 - clock * 9);
        // No extra sway next to text: the reserved distance covers the regular one only.
        const offset =
          Math.max(-sway, Math.min(sway, wave)) * (still ? 0.6 : 1) * Math.min(1, rest / 120);
        x = p.x + p.nx * offset;
        y = p.y + p.ny * offset;
        angle = Math.atan2(-p.nx, p.ny);
        clear = p.bird;
        drawn = true;
        if (y < top - 60 || y > top + height + 60 || (!path.mobile && p.ribbon === 0)) {
          flush();
          continue;
        }
        const turn = Math.cos(p.length / 125 - clock * 0.55 + Math.sin(p.length / 400));
        const w =
          (full *
            (0.1 + 0.9 * Math.abs(turn)) *
            Math.min(1, (rest + 4) / 90) *
            (path.mobile ? 1 : p.ribbon)) /
          2;
        const edge: [number, number, number, number] = [
          x + p.nx * w,
          y + p.ny * w,
          x - p.nx * w,
          y - p.ny * w,
        ];
        const next = turn >= 0 ? 1 : -1;
        // Rounded down, so a partly clear stretch never gets darker than its palest point.
        const shade = path.mobile ? Math.floor(p.ribbon * 4) / 4 : 1;
        if ((next !== side || shade !== tone) && run.length) {
          run.push(edge);
          flush();
        }
        side = next;
        tone = shade;
        run.push(edge);
      }
      flush();
      ctx.globalAlpha = 1;
      if (still || !drawn || clear === 0) return;
      const size = path.mobile ? 0.6 : 1.1;
      const flap = 0.72 + 0.28 * Math.sin(clock * (4 + rush * 14));
      ctx.save();
      ctx.globalAlpha = clear;
      ctx.translate(x, y);
      ctx.rotate(angle);
      ctx.scale(size, size);
      ctx.fillStyle = '#193f3e';
      ctx.beginPath();
      ctx.moveTo(19, 0);
      ctx.quadraticCurveTo(10, -5, -8, -2.5);
      ctx.lineTo(-27, -8);
      ctx.lineTo(-14, 0);
      ctx.lineTo(-27, 8);
      ctx.lineTo(-8, 2.5);
      ctx.quadraticCurveTo(10, 5, 19, 0);
      ctx.fill();
      for (const m of [1, -1]) {
        ctx.beginPath();
        ctx.moveTo(9, 0);
        ctx.quadraticCurveTo(6, m * 20 * flap, -16, m * 30 * flap);
        ctx.quadraticCurveTo(-8, m * 14 * flap, -6, 0);
        ctx.fill();
      }
      ctx.restore();
    }

    function wake() {
      if (document.hidden) return;
      touched = performance.now();
      if (!frame) {
        last = 0;
        frame = requestAnimationFrame(update);
      }
    }
    function remeasure() {
      dirty = true;
      wake();
    }
    function pointer(event: PointerEvent) {
      if (event.pointerType !== 'mouse' || media.matches || scrollY > innerHeight) return;
      const photo = root.querySelector<HTMLElement>('.landing-hero-photo');
      photo?.style.setProperty('--tilt-x', ((event.clientX / innerWidth) * 2 - 1).toFixed(3));
      photo?.style.setProperty('--tilt-y', ((event.clientY / innerHeight) * 2 - 1).toFixed(3));
    }
    const resize = new ResizeObserver(remeasure);
    resize.observe(root);
    for (const section of root.querySelectorAll(':scope > section')) resize.observe(section);
    root.addEventListener('load', remeasure, true);
    root.addEventListener('toggle', remeasure, true);
    window.addEventListener('scroll', wake, { passive: true });
    window.addEventListener('resize', remeasure);
    window.addEventListener('pageshow', remeasure);
    window.addEventListener(privacyClosedEvent, wake);
    window.addEventListener('pointermove', pointer, { passive: true });
    document.addEventListener('visibilitychange', wake);
    media.addEventListener('change', wake);
    void document.fonts.ready.then(() => {
      if (!disposed) remeasure();
    });
    wake();
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      resize.disconnect();
      root.removeEventListener('load', remeasure, true);
      root.removeEventListener('toggle', remeasure, true);
      window.removeEventListener('scroll', wake);
      window.removeEventListener('resize', remeasure);
      window.removeEventListener('pageshow', remeasure);
      window.removeEventListener(privacyClosedEvent, wake);
      window.removeEventListener('pointermove', pointer);
      document.removeEventListener('visibilitychange', wake);
      media.removeEventListener('change', wake);
    };
  }, [revision]);
  return [ref, canvasRef] as const;
}
