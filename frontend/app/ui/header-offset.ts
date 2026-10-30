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
    let frame = 0;
    let hashFrame = 0;
    const reveal = (target: Element | null) => {
      if (
        !mobile.matches ||
        !(target instanceof HTMLElement) ||
        target === document.body ||
        target === root ||
        target.closest('dialog, .header')
      )
        return;
      const box = target.getBoundingClientRect();
      if (box.top < element.getBoundingClientRect().bottom + 12 && box.bottom > 0)
        target.scrollIntoView({ block: 'start', behavior: 'instant' });
    };
    const measure = () => {
      const panel = element.querySelector<HTMLElement>('[data-mobile-menu-panel]');
      element.style.setProperty(
        '--header-controls-height',
        `${Math.ceil(element.getBoundingClientRect().height - (panel?.getBoundingClientRect().height ?? 0))}px`,
      );
      root.style.setProperty(
        '--header-offset',
        mobile.matches ? `${Math.ceil(element.getBoundingClientRect().height)}px` : '0px',
      );
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => reveal(document.activeElement));
    };
    const focus = (event: FocusEvent) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() =>
        reveal(event.target instanceof Element ? event.target : null),
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
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
      observer.disconnect();
      mobile.removeEventListener('change', measure);
      document.removeEventListener('focusin', focus);
      root.style.removeProperty('--header-offset');
    };
  }, [header, pathname, hash]);
}
