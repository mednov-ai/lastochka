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
    const reveal = (target: Element | null) => {
      if (
        !(target instanceof HTMLElement) ||
        target === document.body ||
        target === root ||
        target.closest('dialog, .header, .site-footer')
      )
        return;
      const box = target.getBoundingClientRect();
      if (box.top < element.getBoundingClientRect().bottom + 12 && box.bottom > 0)
        target.scrollIntoView({ block: 'start', behavior: 'instant' });
      else if (
        footer &&
        box.bottom > footer.getBoundingClientRect().top - 12 &&
        box.top < innerHeight
      )
        target.scrollIntoView({ block: 'end', behavior: 'instant' });
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
      observer.disconnect();
      mobile.removeEventListener('change', measure);
      document.removeEventListener('focusin', focus);
      root.style.removeProperty('--header-offset');
      root.style.removeProperty('--footer-offset');
    };
  }, [header, pathname, hash]);
}
