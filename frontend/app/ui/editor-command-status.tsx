import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  acknowledgeExpiredCommand,
  editorCommands,
  editorRevision,
  repeatEditorCommand,
  subscribeEditorCommands,
} from './editor-commands';
export function EditorCommandStatus({ onChanged }: { onChanged: () => Promise<void> }) {
  useSyncExternalStore(subscribeEditorCommands, editorRevision, () => 0);
  const latest = useRef(onChanged);
  latest.current = onChanged;
  const [error, setError] = useState('');
  useEffect(() => {
    const settled = () => {
      void latest.current();
    };
    window.addEventListener('lastochka:calendar-settled', settled);
    return () => window.removeEventListener('lastochka:calendar-settled', settled);
  }, []);
  return editorCommands().length ? (
    <section className="notice command-status" aria-label="Состояние сохранения">
      {editorCommands().map((e) => (
        <div key={e.key}>
          <p role="status">
            {e.status === 'pending'
              ? 'Сохранение выполняется. Закрытие окна не отменит отправленное действие.'
              : 'Результат пока неизвестен. Уточните его перед новой записью этого объекта.'}
          </p>
          {e.status === 'unknown' ? (
            <button
              type="button"
              className="button light"
              onClick={() => {
                setError('');
                void repeatEditorCommand(e.key).catch((err) => setError(String(err.message)));
              }}
            >
              Уточнить результат
            </button>
          ) : null}
          {Date.now() - e.started >= 86400000 ? (
            <button
              type="button"
              className="button light"
              onClick={async () => {
                await latest.current();
                if (
                  window.confirm(
                    'Сверьте расписание и историю. Вы проверили результат прежнего действия?',
                  )
                )
                  acknowledgeExpiredCommand(e.key);
              }}
            >
              Подтвердить сверку данных
            </button>
          ) : null}
        </div>
      ))}
      {error ? <p role="alert">{error}</p> : null}
    </section>
  ) : null;
}
