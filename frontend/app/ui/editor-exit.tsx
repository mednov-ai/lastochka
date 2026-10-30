import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useBlocker } from 'react-router';
import { editorCommands, editorRevision, subscribeEditorCommands } from './editor-commands';
import { flushSync } from 'react-dom';

let guardExit: ((action: () => void) => void) | null = null;
let closeEditor: (() => void) | null = null;
export function requestEditorExit(action: () => void) {
  if (guardExit) guardExit(action);
  else action();
}
export function finishEditorExit() {
  if (closeEditor) flushSync(() => closeEditor?.());
}

export function useEditorExit({
  dirty,
  busy,
  uncertain = false,
  resources,
  onClose,
  registerClose,
}: {
  dirty: boolean;
  busy: boolean;
  uncertain?: boolean;
  onClose: () => void;
  resources?: string[];
  registerClose: (handler: (() => void) | null) => void;
}) {
  useSyncExternalStore(subscribeEditorCommands, editorRevision, () => 0);
  const writing = editorCommands().some((e) => !resources || resources.includes(e.resource));
  const blocker = useBlocker(dirty || writing);
  const [question, setQuestion] = useState<'dirty' | 'writing' | null>(null);
  const pending = useRef<(() => void) | null>(null);
  function navigate(action: () => void) {
    if (writing || dirty) {
      pending.current = action;
      setQuestion(writing ? 'writing' : 'dirty');
    } else action();
  }
  const latest = useRef(() => navigate(onClose));
  latest.current = () => navigate(onClose);
  const guard = useRef(navigate);
  guard.current = navigate;
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    registerClose(() => latest.current());
    const exit = (action: () => void) => guard.current(action);
    const finish = () => close.current();
    guardExit = exit;
    closeEditor = finish;
    return () => {
      registerClose(null);
      if (guardExit === exit) guardExit = null;
      if (closeEditor === finish) closeEditor = null;
    };
  }, []);
  useEffect(() => {
    if (blocker.state === 'blocked') {
      pending.current = () => blocker.proceed();
      setQuestion(writing ? 'writing' : 'dirty');
    }
  }, [blocker.state]);
  useEffect(() => {
    if (!dirty) return;
    const guard = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [dirty]);
  const confirmation = question ? (
    <ExitConfirmation
      writing={question === 'writing'}
      stay={() => {
        pending.current = null;
        setQuestion(null);
        if (blocker.state === 'blocked') blocker.reset();
      }}
      leave={() => {
        const action = pending.current;
        pending.current = null;
        setQuestion(null);
        action?.();
      }}
    />
  ) : null;
  return { navigate, confirmation };
}
function ExitConfirmation({
  writing,
  stay,
  leave,
}: {
  writing: boolean;
  stay: () => void;
  leave: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.current?.showModal();
    dialog.current?.querySelector<HTMLButtonElement>('button')?.focus();
    return () => {
      dialog.current?.close();
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className="editor-exit"
      aria-labelledby="editor-exit-title"
      onCancel={(e) => {
        e.preventDefault();
        e.stopPropagation();
        stay();
      }}
    >
      <h2 id="editor-exit-title">{writing ? 'Закрыть окно?' : 'Выйти без сохранения?'}</h2>
      <p>
        {writing
          ? 'Отправленное действие продолжит выполняться. Результат можно уточнить над календарём.'
          : 'Сохранённый черновик останется. Последний несохранённый ввод будет потерян.'}
      </p>
      <div>
        <button type="button" className="button" onClick={stay}>
          Остаться
        </button>
        <button type="button" className="button light" onClick={leave}>
          {writing ? 'Закрыть окно' : 'Выйти'}
        </button>
      </div>
    </dialog>
  );
}
