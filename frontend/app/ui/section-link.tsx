import { useEffect, useRef, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router';

// Repeating the current hash must reveal its section again, after a menu closes.
export function SectionLink({
  to,
  children,
  className,
  onSelect,
}: {
  to: string;
  children: ReactNode;
  className?: string;
  onSelect?: () => void;
}) {
  const { pathname } = useLocation();
  const frame = useRef(0);
  useEffect(() => () => cancelAnimationFrame(frame.current), []);
  return (
    <Link
      to={to}
      className={className}
      onClick={(event) => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
          return;
        onSelect?.();
        if (pathname !== '/' || !to.startsWith('/#')) return;
        cancelAnimationFrame(frame.current);
        frame.current = requestAnimationFrame(() => {
          frame.current = requestAnimationFrame(() =>
            document
              .getElementById(to.slice(2))
              ?.scrollIntoView({ block: 'start', behavior: 'instant' }),
          );
        });
      }}
    >
      {children}
    </Link>
  );
}
