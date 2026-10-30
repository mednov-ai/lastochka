import { useEffect, useId, useRef, useState } from 'react';
import { formatPhone, parsePhone, phoneTemplate } from './phone';
import { uiText } from './ui-texts';

type Snapshot = { digits: string; start: number; end: number };
export function PhoneInput({
  defaultValue = '',
  errorId,
  invalid = false,
}: {
  defaultValue?: string;
  errorId: string;
  invalid?: boolean;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const initial = parsePhone(defaultValue, true) ?? '';
  const [view, setView] = useState(initial);
  const [enhanced, setEnhanced] = useState(false);
  const [rejected, setRejected] = useState('');
  const digits = useRef(initial);
  const history = useRef<Snapshot[]>([
    { digits: initial, start: initial.length, end: initial.length },
  ]);
  const position = useRef(0);
  const writing = useRef(false);

  useEffect(() => {
    const field = input.current!;
    // Read the DOM before enhancement: the user or autofill may already have typed.
    digits.current = parsePhone(field.value, true) ?? initial;
    history.current = [
      { digits: digits.current, start: digits.current.length, end: digits.current.length },
    ];
    position.current = 0;
    field.removeAttribute('maxlength');
    field.pattern = '[0-9]{3} [0-9]{3}-[0-9]{2}-[0-9]{2}';
    field.value = formatPhone(digits.current);
    setView(field.value);
    setEnhanced(true);

    function range(): [number, number] {
      const count = (p: number) => field.value.substring(0, p).replace(/\D/g, '').length;
      return [count(field.selectionStart ?? 0), count(field.selectionEnd ?? 0)];
    }
    function caret(index: number, value: string) {
      if (!index) return 0;
      let seen = 0;
      for (let p = 0; p < value.length; p++)
        if (/[0-9]/.test(value[p]) && ++seen === index) return p + 1;
      return value.length;
    }
    function show(next: Snapshot, notify = true) {
      digits.current = next.digits;
      const text = formatPhone(next.digits);
      writing.current = true;
      field.value = text;
      field.setCustomValidity('');
      field.setSelectionRange(caret(next.start, text), caret(next.end, text));
      setView(text);
      setRejected('');
      // Let RussianForm clear its previous native error using its normal event path.
      if (notify) field.dispatchEvent(new Event('input', { bubbles: true }));
      writing.current = false;
    }
    function commit(value: string, start: number, end = start) {
      const [oldStart, oldEnd] = range();
      history.current[position.current] = { digits: digits.current, start: oldStart, end: oldEnd };
      if (value !== digits.current) {
        history.current.splice(position.current + 1);
        history.current.push({ digits: value, start, end });
        position.current++;
      }
      show({ digits: value, start, end });
    }
    function undo(forward: boolean) {
      const next = position.current + (forward ? 1 : -1);
      if (next < 0 || next >= history.current.length) return;
      position.current = next;
      show(history.current[next]);
    }
    function remove(back: boolean) {
      let [start, end] = range();
      if (start === end) {
        if (back) start = Math.max(0, start - 1);
        else end = Math.min(digits.current.length, end + 1);
      }
      commit(digits.current.substring(0, start) + digits.current.substring(end), start);
    }
    function insert(text: string, whole: boolean) {
      const parsed = parsePhone(text, true);
      const [start, end] = range();
      const full = whole && text.replace(/\D/g, '').length === 11;
      const next =
        parsed === null
          ? null
          : full
            ? parsed
            : digits.current.substring(0, start) + parsed + digits.current.substring(end);
      if (next === null || next.length > 10) {
        if (whole) setRejected(uiText.phonePaste);
        return;
      }
      commit(next, full ? next.length : start + parsed!.length);
    }
    function before(event: Event) {
      const e = event as InputEvent;
      if (!e.cancelable) return;
      if (e.inputType === 'historyUndo' || e.inputType === 'historyRedo') {
        e.preventDefault();
        undo(e.inputType === 'historyRedo');
      } else if (e.inputType.startsWith('delete')) {
        e.preventDefault();
        remove(e.inputType.includes('Backward'));
      } else if (e.inputType.startsWith('insert') && e.data !== null) {
        e.preventDefault();
        insert(e.data, e.inputType !== 'insertText' || e.data.length > 1);
      }
    }
    function key(e: KeyboardEvent) {
      if (
        (e.metaKey || e.ctrlKey) &&
        !e.altKey &&
        (e.key.toLowerCase() === 'z' || e.key.toLowerCase() === 'y')
      ) {
        e.preventDefault();
        undo(e.shiftKey || e.key.toLowerCase() === 'y');
      } else if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault();
        remove(e.key === 'Backspace');
      }
    }
    function paste(e: ClipboardEvent) {
      e.preventDefault();
      insert(e.clipboardData?.getData('text/plain') ?? '', true);
    }
    function cut(e: ClipboardEvent) {
      const [start, end] = range();
      if (start === end) return;
      e.preventDefault();
      e.clipboardData?.setData(
        'text/plain',
        field.value.substring(field.selectionStart!, field.selectionEnd!),
      );
      commit(digits.current.substring(0, start) + digits.current.substring(end), start);
    }
    function changed() {
      if (writing.current) return;
      const value = field.value;
      const parsed = parsePhone(value, true);
      const cursor = value
        .substring(0, field.selectionStart ?? value.length)
        .replace(/\D/g, '').length;
      if (parsed === null) {
        const saved = history.current[position.current];
        show(saved);
        setRejected(uiText.phonePaste);
      } else commit(parsed, Math.min(cursor, parsed.length));
    }
    function reset() {
      queueMicrotask(() => {
        history.current = [{ digits: initial, start: initial.length, end: initial.length }];
        position.current = 0;
        show(history.current[0]);
      });
    }
    field.addEventListener('beforeinput', before);
    field.addEventListener('keydown', key);
    field.addEventListener('paste', paste);
    field.addEventListener('cut', cut);
    field.addEventListener('input', changed);
    field.addEventListener('change', changed);
    field.form?.addEventListener('reset', reset);
    return () => {
      field.removeEventListener('beforeinput', before);
      field.removeEventListener('keydown', key);
      field.removeEventListener('paste', paste);
      field.removeEventListener('cut', cut);
      field.removeEventListener('input', changed);
      field.removeEventListener('change', changed);
      field.form?.removeEventListener('reset', reset);
    };
    // The input is intentionally uncontrolled; action errors must preserve user edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hint = enhanced ? phoneTemplate.substring(view.length) : '';
  return (
    <>
      <label htmlFor={id}>{uiText.phoneLabel}</label>
      <div
        className="phone-control"
        data-enhanced={enhanced || undefined}
        onClick={() => input.current?.focus()}
      >
        <span className="phone-prefix" aria-hidden="true">
          +7
        </span>
        <span className="phone-national">
          <input
            ref={input}
            id={id}
            name="phoneNational"
            type="tel"
            inputMode="numeric"
            autoComplete="tel-national"
            required
            maxLength={enhanced ? undefined : 10}
            pattern={enhanced ? '[0-9]{3} [0-9]{3}-[0-9]{2}-[0-9]{2}' : '[0-9]{10}'}
            defaultValue={initial}
            placeholder={enhanced ? undefined : phoneTemplate}
            data-phone-national="true"
            aria-describedby={`${id}-hint ${id}-paste ${errorId}`}
            aria-invalid={invalid || !!rejected}
          />
          {enhanced ? (
            <span className="phone-mask" aria-hidden="true">
              <span className="phone-mask-filled">{view}</span>
              {hint}
            </span>
          ) : null}
        </span>
      </div>
      <p className="phone-hint" id={`${id}-hint`}>
        {uiText.phoneHint}
      </p>
      <p className="field-error" id={`${id}-paste`} role="status">
        {rejected}
      </p>
    </>
  );
}
