import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

function Toast({ text, dismiss }: { text: string; dismiss: () => void }) {
  const remaining = useRef(6000);
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const [hidden, setHidden] = useState(false);
  const dismissRef = useRef(dismiss);
  dismissRef.current = dismiss;
  useEffect(() => {
    const changed = () => setHidden(document.hidden);
    changed();
    document.addEventListener('visibilitychange', changed);
    return () => document.removeEventListener('visibilitychange', changed);
  }, []);
  useEffect(() => {
    if (hover || focus || hidden) return;
    const start = performance.now();
    const timer = setTimeout(() => dismissRef.current(), remaining.current);
    return () => {
      clearTimeout(timer);
      remaining.current -= performance.now() - start;
    };
  }, [hover, focus, hidden]);
  return (
    <div
      className="error-toast"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setFocus(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setFocus(false);
      }}
    >
      <p role="alert">{text}</p>
      <button type="button" aria-label="Закрыть уведомление" onClick={dismiss}>
        ×
      </button>
    </div>
  );
}
export function ErrorToasts() {
  const [target, setTarget] = useState<Element | null>(null);
  const [items, setItems] = useState<{ id: number; text: string }[]>([]);
  const sequence = useRef(0);
  useEffect(() => {
    const layer = document.createElement('div');
    layer.className = 'error-toast-layer';
    const relocate = () => {
      const dialogs = document.querySelectorAll('dialog[open]');
      const parent = dialogs.item(dialogs.length - 1) ?? document.body;
      if (layer.parentElement !== parent) parent.appendChild(layer);
    };
    relocate();
    setTarget(layer);
    const observer = new MutationObserver(relocate);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['open'],
    });
    const receive = (event: Event) => {
      const text: unknown = (event as CustomEvent).detail;
      if (typeof text === 'string') {
        const id = ++sequence.current;
        setItems((old) => [...old, { id, text }].slice(-3));
      }
    };
    window.addEventListener('lastochka:error', receive);
    return () => {
      observer.disconnect();
      layer.remove();
      window.removeEventListener('lastochka:error', receive);
    };
  }, []);
  return target
    ? createPortal(
        <section className="error-toasts" aria-label="Уведомления об ошибках">
          {items.map((item) => (
            <Toast
              key={item.id}
              text={item.text}
              dismiss={() => setItems((old) => old.filter((i) => i.id !== item.id))}
            />
          ))}
        </section>,
        target,
      )
    : null;
}
