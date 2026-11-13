import { useEffect, type RefObject } from 'react';
import { useLocation } from 'react-router';

// Sticky positioning works in CSS; this only refines scroll targets after resize.
export function useHeaderOffset(header: RefObject<HTMLElement | null>) {
  const { pathname, hash } = useLocation();
  useEffect(() => {
    const element = header.current;
    if (!element) return;
    const mobile = matchMedia('(max-width: 1000px)');
    const root = document.documentElement;
    const footer = document.querySelector<HTMLElement>('.site-footer');
    let frame = 0;
    let hashFrame = 0;
    let correctionFrame = 0;
    let pointerDown = false;
    const reveal = (target: Element | null) => {
      if (
        !(target instanceof HTMLElement) ||
        target === document.body ||
        target === root ||
        target.closest('dialog, .header, .site-footer')
      )
        return;
      const box = target.getBoundingClientRect();
      if (box.top < element.getBoundingClientRect().bottom + 12)
        target.scrollIntoView({ block: 'start', behavior: 'instant' });
      else if (
        footer &&
        box.bottom > footer.getBoundingClientRect().top - 12
      )
        target.scrollIntoView({ block: 'end', behavior: 'instant' });
      cancelAnimationFrame(correctionFrame);
      correctionFrame = requestAnimationFrame(() => {
        if (document.activeElement !== target) return;
        const current = target.getBoundingClientRect();
        const top = element.getBoundingClientRect().bottom + 3;
        const bottom = (footer?.getBoundingClientRect().top ?? innerHeight) - 3;
        if (current.height > bottom - top) return;
        const delta = current.top < top ? current.top - top : current.bottom > bottom ? current.bottom - bottom : 0;
        if (delta) window.scrollBy({ top: delta, behavior: 'instant' });
      });
    };
    const measure = () => {
      const panel = element.querySelector<HTMLElement>('[data-mobile-menu-panel]');
      element.style.setProperty(
        '--header-controls-height',
        `${Math.ceil(element.getBoundingClientRect().height - (panel?.getBoundingClientRect().height ?? 0))}px`,
      );
      root.style.setProperty(
        '--header-offset',
        `${Math.ceil(element.getBoundingClientRect().height)}px`,
      );
      if (footer)
        root.style.setProperty(
          '--footer-offset',
          `${Math.ceil(footer.getBoundingClientRect().height)}px`,
        );
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => { if (!pointerDown) reveal(document.activeElement); });
    };
    const focus = (event: FocusEvent) => {
      // Do not move a button between pointerdown and pointerup; keyboard focus still needs correction.
      if (pointerDown) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() =>
        reveal(event.target instanceof Element ? event.target : null),
      );
    };
    measure();
    const pointerStart = () => {
      pointerDown = true;
      cancelAnimationFrame(frame);
      cancelAnimationFrame(correctionFrame);
    };
    const pointerEnd = () => { pointerDown = false; };
    document.addEventListener('pointerdown', pointerStart, true);
    document.addEventListener('pointerup', pointerEnd, true);
    document.addEventListener('pointercancel', pointerEnd, true);
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    if (footer) observer.observe(footer);
    mobile.addEventListener('change', measure);
    document.addEventListener('focusin', focus);
    if (hash) {
      let id: string;
      try {
        id = decodeURIComponent(hash.slice(1));
      } catch {
        id = '';
      }
      const target = document.getElementById(id);
      hashFrame = requestAnimationFrame(() =>
        target?.scrollIntoView({ block: 'start', behavior: 'instant' }),
      );
    }
    return () => {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(hashFrame);
      cancelAnimationFrame(correctionFrame);
      observer.disconnect();
      mobile.removeEventListener('change', measure);
      document.removeEventListener('focusin', focus);
      document.removeEventListener('pointerdown', pointerStart, true);
      document.removeEventListener('pointerup', pointerEnd, true);
      document.removeEventListener('pointercancel', pointerEnd, true);
      root.style.removeProperty('--header-offset');
      root.style.removeProperty('--footer-offset');
    };
  }, [header, pathname, hash]);
}
