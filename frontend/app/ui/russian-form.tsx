import { useId, useRef, useState, type ComponentProps, type FormEvent } from 'react';
import { uiText } from './ui-texts';

type Field = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
type Entry = { field: Field; id: string; text: string; previousInvalid: string | null };
const isField = (target: EventTarget | null): target is Field =>
  target instanceof HTMLInputElement ||
  target instanceof HTMLSelectElement ||
  target instanceof HTMLTextAreaElement;

export function validationText(field: Field): string {
  const v = field.validity;
  const input = field instanceof HTMLInputElement ? field : null;
  if (input?.dataset.phoneNational && !v.valid) return uiText.phoneIncomplete;
  const isDate = input && ['date', 'datetime-local', 'time', 'month', 'week'].includes(input.type);
  if (v.badInput) return isDate ? uiText.date : uiText.number;
  if (v.valueMissing) return field instanceof HTMLSelectElement ? uiText.select : uiText.required;
  if (v.typeMismatch) return input?.type === 'email' ? uiText.emailInvalid : uiText.format;
  if (v.tooShort) return uiText.tooShort;
  if (v.tooLong) return uiText.tooLong;
  if (v.rangeUnderflow) return isDate ? uiText.dateMinimum(input!.min) : uiText.minimum(input!.min);
  if (v.rangeOverflow) return isDate ? uiText.dateMaximum(input!.max) : uiText.maximum(input!.max);
  if (v.stepMismatch) return uiText.step;
  if (v.patternMismatch) return uiText.format;
  return uiText.invalid;
}

// Keep browser constraints and submit semantics. Own messages survive native bubbles.
export function RussianForm({
  children,
  onInvalidCapture,
  onInputCapture,
  onChangeCapture,
  onReset,
  ...props
}: ComponentProps<'form'>) {
  const prefix = useId();
  const sequence = useRef(0);
  const entries = useRef(new Map<Field, Entry>());
  const [errors, setErrors] = useState<Entry[]>([]);
  function clear(field: Field) {
    const entry = entries.current.get(field);
    if (!entry) return;
    field.setCustomValidity('');
    const described = (field.getAttribute('aria-describedby') ?? '')
      .split(/\s+/)
      .filter((id) => id && id !== entry.id);
    if (described.length) field.setAttribute('aria-describedby', described.join(' '));
    else field.removeAttribute('aria-describedby');
    // Preserve React's field-error ownership if it has changed while our error was visible.
    if (field.getAttribute('aria-invalid') === 'true') {
      if (entry.previousInvalid !== null) field.setAttribute('aria-invalid', entry.previousInvalid);
      else field.removeAttribute('aria-invalid');
    }
    entries.current.delete(field);
  }
  function changed(event: FormEvent<HTMLFormElement>) {
    if (!isField(event.target)) return;
    const previousCount = entries.current.size;
    clear(event.target);
    // Conditional fields may have been removed or disabled between submissions.
    for (const field of entries.current.keys())
      if (!field.isConnected || !field.willValidate) clear(field);
    // Не перерисовывать форму на каждом вводе, если список ошибок не изменился.
    if (entries.current.size !== previousCount) setErrors([...entries.current.values()]);
  }
  return (
    <form
      {...props}
      onInvalidCapture={(event) => {
        const field = event.target;
        if (isField(field)) {
          const previous = entries.current.get(field);
          field.setCustomValidity('');
          if (!field.validity.valid) {
            const entry = {
              field,
              id: previous?.id ?? `${prefix}-error-${sequence.current++}`,
              text: validationText(field),
              previousInvalid: previous
                ? previous.previousInvalid
                : field.getAttribute('aria-invalid'),
            };
            field.setCustomValidity(entry.text);
            field.setAttribute('aria-invalid', 'true');
            const ids = new Set(
              (field.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean),
            );
            ids.add(entry.id);
            field.setAttribute('aria-describedby', [...ids].join(' '));
            entries.current.set(field, entry);
            setErrors([...entries.current.values()]);
          } else clear(field);
        }
        onInvalidCapture?.(event);
      }}
      onInputCapture={(event) => {
        changed(event);
        onInputCapture?.(event);
      }}
      onChangeCapture={(event) => {
        changed(event);
        onChangeCapture?.(event);
      }}
      onReset={(event) => {
        for (const field of entries.current.keys()) clear(field);
        setErrors([]);
        onReset?.(event);
      }}
    >
      {children}
      {errors.length ? (
        <div className="form-validation" aria-live="polite">
          {errors
            .filter(({ field }) => field.isConnected && field.willValidate)
            .map(({ field, id, text }) => (
              <p key={id} id={id} className="field-error">
                <button className="validation-link" type="button" onClick={() => field.focus()}>
                  {field.getAttribute('aria-label') ||
                    field.labels?.[0]?.textContent?.trim() ||
                    uiText.invalid}
                  : {text}
                </button>
              </p>
            ))}
        </div>
      ) : null}
    </form>
  );
}
