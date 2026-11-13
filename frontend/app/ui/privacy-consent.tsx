import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router';
import { uiText } from './ui-texts';

/** Edition of the published policy; a new edition asks every visitor again. */
export const privacyRevision = '2026-11-10';
const storageKey = `lastochka-privacy-consent:${privacyRevision}`;
// Used when the browser refuses storage: the answer then lasts until the page is reloaded.
let acceptedInMemory = false;

function accepted() {
  if (acceptedInMemory) return true;
  try {
    return localStorage.getItem(storageKey) !== null;
  } catch {
    return false;
  }
}

/** First-visit window on public pages. The policy itself and staff sections stay readable without it. */
export function PrivacyConsent() {
  const { pathname } = useLocation();
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const applies = pathname === '/' || pathname === '/enquiry';
  useEffect(() => {
    // Automated browsers (tests, availability checks) are not visitors and cannot give consent.
    setOpen(applies && !navigator.webdriver && !accepted());
  }, [applies]);
  useEffect(() => {
    const element = dialog.current;
    if (!open || !element) return;
    if (!element.open) element.showModal();
    element.querySelector('button')?.focus();
    return () => element.close();
  }, [open]);
  if (!open) return null;
  const agree = () => {
    acceptedInMemory = true;
    try {
      localStorage.setItem(storageKey, new Date().toISOString());
    } catch {
      // Storage is unavailable; the in-memory answer keeps the window closed for this page.
    }
    setOpen(false);
  };
  return (
    <dialog
      ref={dialog}
      className="privacy-consent"
      aria-labelledby="privacy-consent-title"
      onCancel={(event) => event.preventDefault()}
    >
      <h2 id="privacy-consent-title">{uiText.privacyConsentTitle}</h2>
      <p>
        {uiText.privacyConsentText} <Link to="/legal/privacy">{uiText.privacyConsentLink}</Link>.
      </p>
      <p>{uiText.privacyConsentAction}</p>
      <button className="button" type="button" onClick={agree}>
        {uiText.privacyConsentAgree}
      </button>
    </dialog>
  );
}
