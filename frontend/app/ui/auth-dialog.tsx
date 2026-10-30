import {
  createContext,
  useContext,
  useState,
  useRef,
  useEffect,
  lazy,
  Suspense,
  useCallback,
} from 'react';
import { Link } from 'react-router';
const AuthForm = lazy(() => import('./auth-form'));
type Request = { action: string; next?: string; trigger: HTMLElement | null };
const Context = createContext<(next?: string, action?: string, trigger?: HTMLElement) => void>(
  () => {},
);
export function AuthDialogProvider({ children }: { children: React.ReactNode }) {
  const [request, setRequest] = useState<Request | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const open = useCallback((next?: string, action = 'login', trigger?: HTMLElement) => {
    setRequest({
      action,
      next,
      trigger:
        trigger ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null),
    });
  }, []);
  const isOpen = request !== null;
  const trigger = request?.trigger;
  useEffect(() => {
    if (!isOpen || !dialog.current) return;
    const element = dialog.current;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    element.showModal();
    return () => {
      element.close();
      document.body.style.overflow = overflow;
      trigger?.focus({ preventScroll: true });
    };
  }, [isOpen, trigger]);
  return (
    <Context.Provider value={open}>
      {children}
      <dialog
        ref={dialog}
        className="auth-dialog"
        aria-labelledby="auth-dialog-title"
        onKeyDown={(event) => {
          if (event.key !== 'Tab') return;
          const targets = [
            ...event.currentTarget.querySelectorAll<HTMLElement>(
              'button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href],[tabindex="0"]',
            ),
          ].filter((el) => el.getClientRects().length > 0);
          const first = targets[0],
            last = targets[targets.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }}
        onCancel={() => setRequest(null)}
        onClose={() => setRequest(null)}
      >
        {request ? (
          <>
            <button
              type="button"
              className="dialog-close"
              aria-label="Закрыть окно входа"
              onClick={() => setRequest(null)}
            >
              ×
            </button>
            <Suspense
              fallback={
                <p role="status" id="auth-dialog-title">
                  Загрузка формы…
                </p>
              }
            >
              <AuthForm
                action={request.action}
                next={request.next}
                modal

                onSuccess={() => setRequest(null)}
              />
            </Suspense>
          </>
        ) : null}
      </dialog>
    </Context.Provider>
  );
}
export const useAuthDialog = () => useContext(Context);
export function AuthLink({
  children,
  next,
  action = 'login',
  className,
}: {
  children: React.ReactNode;
  next?: string;
  action?: string;
  className?: string;
}) {
  const open = useAuthDialog();
  return (
    <Link
      className={className}
      to={'/auth/' + action + (next ? '?next=' + encodeURIComponent(next) : '')}
      onClick={(event) => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
          return;
        event.preventDefault();
        open(next, action, event.currentTarget);
      }}
    >
      {children}
    </Link>
  );
}
