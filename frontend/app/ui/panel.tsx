import { createContext, useContext, useEffect, useRef, useState } from 'react';
const Title = createContext<((value: string) => void) | null>(null);
export function usePanelTitle(value: string) {
  const setTitle = useContext(Title);
  useEffect(() => {
    setTitle?.(value);
  }, [value, setTitle]);
}

export function Panel({
  title,
  children,
  onClose,
  compact = false,
  payment = false,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  compact?: boolean;
  payment?: boolean;
}) {
  const [heading, setHeading] = useState(title);
  useEffect(() => setHeading(title), [title]);
  const ref = useRef<HTMLDialogElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const triggerSession = trigger?.closest<HTMLElement>('[data-session-id]')?.dataset.sessionId;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    el.showModal();
    el.querySelector<HTMLElement>('[data-panel-heading]')?.focus({ preventScroll: true });
    return () => {
      el.close();
      document.body.style.overflow = previous;
      const target = trigger?.isConnected
        ? trigger
        : ((triggerSession
            ? document.querySelector<HTMLElement>(
                `[data-session-id="${triggerSession}"] .calendar-event-body`,
              )
            : null) ?? document.querySelector<HTMLElement>('[data-calendar-focus]'));
      target?.focus({ preventScroll: true });
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={`workspace-panel${compact ? ' calendar-dialog' : ''}${payment ? ' payment-dialog' : ''}`}
      aria-labelledby="workspace-panel-title"
      onFocusCapture={(event) => {
        const target = event.target;
        if (
          compact &&
          (target instanceof HTMLInputElement ||
            target instanceof HTMLSelectElement ||
            target instanceof HTMLTextAreaElement)
        )
          requestAnimationFrame(() => {
            if (document.activeElement === target)
              target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
          });
      }}
      onCancel={(e) => {
        e.preventDefault();
        close.current();
      }}
    >
      <header className="panel-heading">
        <h2 id="workspace-panel-title" data-panel-heading title={heading} tabIndex={-1}>
          {heading}
        </h2>
        <button
          type="button"
          className="button light"
          onClick={onClose}
          aria-label="Закрыть панель"
        >
          <span aria-hidden="true">×</span>
        </button>
      </header>
      <Title.Provider value={setHeading}>
        <div className="panel-body">{children}</div>
      </Title.Provider>
    </dialog>
  );
}
