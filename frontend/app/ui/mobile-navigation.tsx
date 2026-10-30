import { useCallback, useEffect, useId, useRef, useState, type RefObject } from 'react';
import { useLocation } from 'react-router';
import { SectionLink } from './section-link';
import { uiText } from './ui-texts';

export const headerLinks = [
  { to: '/#approach', text: uiText.navigationAbout },
  { to: '/#formats', text: uiText.navigationFormats },
  { to: '/#coach', text: uiText.navigationCoach },
  { to: '/#contacts', text: uiText.navigationContacts },
  { to: '/#schedule', text: uiText.navigationSchedule },
] as const;

export function MobileNavigation({ header }: { header: RefObject<HTMLElement | null> }) {
  const [open, setOpen] = useState(false);
  const [ready, setReady] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);
  const menuFocused = useRef(false);
  const id = useId();
  const location = useLocation();
  useEffect(() => setReady(true), []);
  const close = useCallback(() => {
    setOpen(false);
    if (header.current) header.current.scrollTop = 0;
  }, [header]);

  useEffect(() => close(), [location.key, close]);
  useEffect(() => {
    const mobile = matchMedia('(max-width: 1000px)');
    const rememberFocus = (event: FocusEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLElement) || target === document.body) return;
      menuFocused.current = target === toggle.current || !!panel.current?.contains(target);
    };
    const resize = () => {
      if (mobile.matches) return;
      if (
        document.activeElement === toggle.current ||
        panel.current?.contains(document.activeElement) ||
        (document.activeElement === document.body && menuFocused.current)
      )
        header.current?.querySelector<HTMLElement>('.brand')?.focus({ preventScroll: true });
      close();
    };
    mobile.addEventListener('change', resize);
    document.addEventListener('focusin', rememberFocus);
    return () => {
      mobile.removeEventListener('change', resize);
      document.removeEventListener('focusin', rememberFocus);
    };
  }, [close, header]);

  useEffect(() => {
    if (!open) return;
    let pointerActive = false;
    const outside = (event: PointerEvent | FocusEvent) => {
      if (event.target instanceof Node && !header.current?.contains(event.target)) close();
    };
    const pointer = () => {
      pointerActive = true;
    };
    const focus = (event: FocusEvent) => {
      if (!pointerActive) outside(event);
    };
    const activate = (event: MouseEvent) => {
      pointerActive = false;
      if (event.target instanceof Node && !header.current?.contains(event.target)) close();
    };
    const cancelPointer = () => {
      pointerActive = false;
    };
    const escape = (event: KeyboardEvent) => {
      pointerActive = false;
      const active = document.activeElement;
      if (
        event.key !== 'Escape' ||
        (active !== document.body &&
          active !== document.documentElement &&
          !header.current?.contains(active))
      )
        return;
      event.preventDefault();
      close();
      toggle.current?.focus({ preventScroll: true });
    };
    const action = (event: MouseEvent) => {
      if (event.target instanceof Element && event.target.closest('.header-actions, .brand'))
        close();
    };
    const element = header.current;
    document.addEventListener('pointerdown', pointer);
    document.addEventListener('pointercancel', cancelPointer);
    document.addEventListener('click', activate);
    document.addEventListener('focusin', focus);
    document.addEventListener('keydown', escape);
    element?.addEventListener('click', action, true);
    return () => {
      document.removeEventListener('pointerdown', pointer);
      document.removeEventListener('pointercancel', cancelPointer);
      document.removeEventListener('click', activate);
      document.removeEventListener('focusin', focus);
      document.removeEventListener('keydown', escape);
      element?.removeEventListener('click', action, true);
    };
  }, [open, close, header]);

  return (
    <>
      <button
        ref={toggle}
        type="button"
        className="mobile-menu-toggle"
        disabled={!ready}
        aria-label={uiText.navigationMenu}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((value) => !value)}
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <path d={open ? 'M5 5l14 14M19 5L5 19' : 'M4 6h16M4 12h16M4 18h16'} />
        </svg>
      </button>
      <nav
        ref={panel}
        id={id}
        className="mobile-navigation"
        data-mobile-menu-panel
        aria-label={uiText.mobileNavigation}
        hidden={!open}
      >
        {headerLinks.map((link) => (
          <SectionLink key={link.to} to={link.to} onSelect={close}>
            {link.text}
          </SectionLink>
        ))}
      </nav>
      <noscript className="mobile-menu-fallback-host">
        <style>{`.mobile-menu-toggle { display: none !important; } @media (max-width: 1000px) { .mobile-menu-fallback-host { display: contents; } }`}</style>
        <details className="mobile-menu-fallback">
          <summary aria-label={uiText.navigationMenu}>
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <path className="menu-icon-closed" d="M4 6h16M4 12h16M4 18h16" />
              <path className="menu-icon-open" d="M5 5l14 14M19 5L5 19" />
            </svg>
          </summary>
          <nav className="mobile-navigation" aria-label={uiText.mobileNavigation}>
            {headerLinks.map((link) => (
              <a key={link.to} href={`${import.meta.env.BASE_URL}${link.to.slice(1)}`}>
                {link.text}
              </a>
            ))}
          </nav>
        </details>
      </noscript>
    </>
  );
}
