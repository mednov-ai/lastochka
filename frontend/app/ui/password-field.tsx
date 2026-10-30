import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { uiText } from './ui-texts';

export function PasswordField({
  name,
  label,
  error,
  autoComplete = 'new-password',
}: {
  name: string;
  label: string;
  error?: string;
  autoComplete?: 'new-password' | 'current-password';
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [visible, setVisible] = useState(false);
  const [ready, setReady] = useState(false);
  const selection = useRef<{
    start: number | null;
    end: number | null;
    direction: 'forward' | 'backward' | 'none' | null;
    focused: boolean;
  } | null>(null);
  const pointerSelection = useRef<(typeof selection)['current']>(null);
  useEffect(() => {
    setReady(true);
    const form = input.current?.form;
    const reset = () => setVisible(false);
    form?.addEventListener('reset', reset);
    return () => form?.removeEventListener('reset', reset);
  }, []);
  useLayoutEffect(() => {
    const field = input.current;
    const saved = selection.current;
    selection.current = null;
    if (!field || !saved) return;
    if (saved.focused) field.focus({ preventScroll: true });
    field.setSelectionRange(saved.start, saved.end, saved.direction ?? undefined);
  }, [visible]);
  const action = visible ? uiText.hidePassword(label) : uiText.showPassword(label);
  return (
    <div className="password-field">
      <label htmlFor={id}>{label}</label>
      <div className="password-control">
        <input
          ref={input}
          id={id}
          name={name}
          type={visible ? 'text' : 'password'}
          required
          maxLength={256}
          autoComplete={autoComplete}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          aria-invalid={!!error}
          aria-describedby={`${id}-error`}
        />
        <button
          type="button"
          className="password-toggle"
          disabled={!ready}
          aria-controls={id}
          aria-label={action}
          title={action}
          onPointerDown={(event) => {
            const field = input.current;
            if (!field || !event.isPrimary || event.button !== 0) return;
            pointerSelection.current = {
              start: field.selectionStart,
              end: field.selectionEnd,
              direction: field.selectionDirection,
              focused: document.activeElement === field,
            };
            if (event.pointerType === 'mouse' && pointerSelection.current.focused)
              event.preventDefault();
          }}
          onPointerCancel={() => {
            pointerSelection.current = null;
          }}
          onClick={(event) => {
            const field = input.current;
            if (!field) return;
            selection.current =
              event.detail > 0 && pointerSelection.current
                ? pointerSelection.current
                : {
                    start: field.selectionStart,
                    end: field.selectionEnd,
                    direction: field.selectionDirection,
                    focused: document.activeElement === field,
                  };
            pointerSelection.current = null;
            setVisible((value) => !value);
          }}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            aria-hidden="true"
            focusable="false"
          >
            <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
            <circle cx="12" cy="12" r="3" />
            {visible ? <path d="m3 3 18 18" /> : null}
          </svg>
        </button>
      </div>
      <p id={`${id}-error`} className="field-error">
        {error}
      </p>
    </div>
  );
}
