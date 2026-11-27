import { useEffect, type RefObject } from 'react';

// Sticky positioning works in CSS; this only refines scroll targets after resize.
export function useHeaderOffset(header: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const element = header.current;
    if (!element) return;
    const mobile = matchMedia('(max-width: 1000px)');
    const root = document.documentElement;
    const footer = document.querySelector<HTMLElement>('.site-footer');
    const footerPinned = () => footer !== null && getComputedStyle(footer).position === 'sticky';
    let frame = 0;
    let correctionFrame = 0;
    let restHeight = 0;
    let pointerDown = false;
    // Desktop only: the bar gets smaller once the page is scrolled. The gap between the two
    // thresholds keeps it from flickering when the reader stops near the switch point.
    const compact = () => {
      const on = root.classList.contains('header-compact');
      const next = !mobile.matches && (on ? scrollY > 8 : scrollY > 96);
      if (next !== on) root.classList.toggle('header-compact', next);
    };
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
      else if (footer && footerPinned() && box.bottom > footer.getBoundingClientRect().top - 12)
        target.scrollIntoView({ block: 'end', behavior: 'instant' });
      cancelAnimationFrame(correctionFrame);
      correctionFrame = requestAnimationFrame(() => {
        if (document.activeElement !== target) return;
        const current = target.getBoundingClientRect();
        const top = element.getBoundingClientRect().bottom + 3;
        const bottom =
          (footer && footerPinned() ? footer.getBoundingClientRect().top : innerHeight) - 3;
        if (current.height > bottom - top) return;
        const delta =
          current.top < top
            ? current.top - top
            : current.bottom > bottom
              ? current.bottom - bottom
              : 0;
        if (delta) window.scrollBy({ top: delta, behavior: 'instant' });
      });
    };
    const measure = () => {
      const panel = element.querySelector<HTMLElement>('[data-mobile-menu-panel]');
      // Keep the header's space in the page constant, so shrinking it never moves the text below.
      const height = element.getBoundingClientRect().height;
      // A quick Back can interrupt the expansion halfway through. Only record its final height.
      if (!root.classList.contains('header-compact') && !element.getAnimations().length)
        restHeight = height;
      element.style.marginBottom = restHeight > height ? `${restHeight - height}px` : '';
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
          `${footerPinned() ? Math.ceil(footer.getBoundingClientRect().height) : 0}px`,
        );
    };
    const focus = (event: FocusEvent) => {
      // Moving the focused element between pointerdown and pointerup can cancel the click.
      // Keyboard focus still needs the sticky header/footer correction.
      if (pointerDown) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() =>
        reveal(event.target instanceof Element ? event.target : null),
      );
    };
    measure();
    compact();
    // Reserve the full header height before animating subsequent scroll interactions.
    measure();
    element.classList.add('header-measured');
    const resized = () => {
      compact();
      measure();
      // Only keep an element visible on a real viewport resize if it is still on screen.
      // A previously focused control may have been intentionally scrolled away.
      const target = document.activeElement;
      if (!(target instanceof HTMLElement)) return;
      const box = target.getBoundingClientRect();
      if (box.bottom <= 0 || box.top >= innerHeight) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!pointerDown) reveal(target);
      });
    };
    addEventListener('scroll', compact, { passive: true });
    const pointerStart = () => {
      pointerDown = true;
      cancelAnimationFrame(frame);
      cancelAnimationFrame(correctionFrame);
    };
    const pointerEnd = () => {
      pointerDown = false;
    };
    const userScroll = () => {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(correctionFrame);
    };
    const scrollKey = (event: KeyboardEvent) => {
      if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key))
        userScroll();
    };
    document.addEventListener('pointerdown', pointerStart, true);
    document.addEventListener('pointerup', pointerEnd, true);
    document.addEventListener('pointercancel', pointerEnd, true);
    addEventListener('wheel', userScroll, { passive: true });
    addEventListener('touchmove', userScroll, { passive: true });
    addEventListener('keydown', scrollKey);
    addEventListener('resize', resized);
    const observer = new ResizeObserver(measure);
    observer.observe(element, { box: 'border-box' });
    if (footer) observer.observe(footer);
    mobile.addEventListener('change', resized);
    document.addEventListener('focusin', focus);
    return () => {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(correctionFrame);
      observer.disconnect();
      mobile.removeEventListener('change', resized);
      removeEventListener('scroll', compact);
      document.removeEventListener('pointerdown', pointerStart, true);
      document.removeEventListener('pointerup', pointerEnd, true);
      document.removeEventListener('pointercancel', pointerEnd, true);
      removeEventListener('wheel', userScroll);
      removeEventListener('touchmove', userScroll);
      removeEventListener('keydown', scrollKey);
      removeEventListener('resize', resized);
      element.classList.remove('header-measured');
      root.classList.remove('header-compact');
      element.style.marginBottom = '';
      document.removeEventListener('focusin', focus);
      root.style.removeProperty('--header-offset');
      root.style.removeProperty('--footer-offset');
    };
  }, [header]);
}
