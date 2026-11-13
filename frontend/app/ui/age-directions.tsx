import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { api, csrf, message } from '../api/client';
import { appPath } from '../api/base-path';
import type { components } from '../api/schema';
import { editorCommands, editorRevision, subscribeEditorCommands } from './editor-commands';
import { useEditorExit } from './editor-exit';
import { RussianForm } from './russian-form';
import { publicFields } from './error-feedback';

type Direction = components['schemas']['AgeDirectionView'];
type Form = {
  title: string;
  description: string;
  ageFrom: string;
  ageTo: string;
  ageOpenEnded: boolean;
  active: boolean;
  sortOrder: string;
};
const blank = (): Form => ({
  title: '',
  description: '',
  ageFrom: '',
  ageTo: '',
  ageOpenEnded: false,
  active: true,
  sortOrder: '0',
});
const formFor = (item: Direction): Form => ({
  title: item.title,
  description: item.description,
  ageFrom: String(item.ageFrom),
  ageTo: item.ageTo == null ? '' : String(item.ageTo),
  ageOpenEnded: item.ageOpenEnded,
  active: item.active,
  sortOrder: String(item.sortOrder),
});

export function AgeDirections({
  onClose,
  registerClose,
}: {
  onClose: () => void;
  registerClose: (handler: (() => void) | null) => void;
}) {
  const [items, setItems] = useState<Direction[] | null>(null);
  const [selected, setSelected] = useState<Direction | null>(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Form>(blank);
  const [baseline, setBaseline] = useState('');
  const [error, setError] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const key = useRef(crypto.randomUUID());
  const prefix = useId();
  useSyncExternalStore(subscribeEditorCommands, editorRevision, () => 0);
  const resource = appPath('/api/v1/admin/age-directions') + (selected ? '/' + selected.id : '');
  const pending = editorCommands().some((entry) => entry.resource === resource);
  const dirty = editing && JSON.stringify(form) !== baseline;
  const { navigate, confirmation } = useEditorExit({
    dirty,
    busy,
    resources: [resource],
    onClose,
    registerClose,
  });

  async function load() {
    const result = await api.GET('/api/v1/admin/age-directions');
    if (result.error) throw result.error;
    setItems(result.data.items);
  }
  useEffect(() => {
    void load().catch((e) => setError(message(e)));
  }, []);
  function open(item: Direction | null) {
    const initial = item ? formFor(item) : blank();
    setSelected(item);
    setForm(initial);
    setBaseline(JSON.stringify(initial));
    setEditing(true);
    setError('');
    setFields({});
    setNotice('');
    key.current = crypto.randomUUID();
  }
  function change<K extends keyof Form>(field: K, value: Form[K]) {
    setForm((current) => ({ ...current, [field]: value }));
    setError('');
    setFields((current) => ({ ...current, [field]: '' }));
    key.current = crypto.randomUUID();
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (busy || pending) return;
    setBusy(true);
    setError('');
    try {
      const headers = { ...(await csrf()), 'Idempotency-Key': key.current };
      const body = {
        title: form.title,
        description: form.description,
        ageFrom: Number(form.ageFrom),
        ageTo: form.ageOpenEnded ? null : Number(form.ageTo),
        ageOpenEnded: form.ageOpenEnded,
        active: form.active,
        sortOrder: Number(form.sortOrder),
        expectedVersion: selected?.version ?? 0,
      };
      const result = selected
        ? await api.PUT('/api/v1/admin/age-directions/{id}', {
            params: { path: { id: selected.id }, header: { 'Idempotency-Key': key.current } },
            headers,
            body,
          })
        : await api.POST('/api/v1/admin/age-directions', {
            params: { header: { 'Idempotency-Key': key.current } },
            headers,
            body,
          });
      if (result.error) throw result.error;
      await load();
      setEditing(false);
      setSelected(null);
      setNotice('Направление сохранено. Существующие занятия и заявки не изменены.');
    } catch (e) {
      setError(message(e));
      setFields(publicFields(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="age-directory">
      {confirmation}
      <p>Активные направления видны на сайте. Изменения не меняют прежние занятия и заявки.</p>
      {error ? (
        <p className="notice error" role="alert">
          {error} {editing ? 'Введённые данные сохранены в форме.' : ''}
        </p>
      ) : null}
      {notice ? (
        <p className="notice" role="status">
          {notice}
        </p>
      ) : null}
      {!items && !error ? <p role="status">Загрузка направлений…</p> : null}
      {items && !editing ? (
        <>
          <button type="button" className="button" onClick={() => open(null)}>
            Добавить направление
          </button>
          {items.length === 0 ? <p>Направлений пока нет.</p> : null}
          <div className="age-directory-list">
            {items.map((item) => (
              <article className="list-card" key={item.id}>
                <div>
                  <h3>{item.title}</h3>
                  <p>{item.active ? 'Активно' : 'В архиве'}</p>
                </div>
                <button
                  type="button"
                  className="button light"
                  onClick={() => open(item)}
                  aria-label={`Изменить ${item.title}`}
                >
                  Изменить
                </button>
              </article>
            ))}
          </div>
        </>
      ) : null}
      {editing ? (
        <RussianForm className="panel-form" onSubmit={(event) => void save(event)}>
          <h3>{selected ? 'Изменить направление' : 'Новое направление'}</h3>
          <label htmlFor={prefix + '-title'}>Название</label>
          <input
            id={prefix + '-title'}
            name="title"
            required
            maxLength={100}
            aria-invalid={!!fields.title}
            aria-describedby={fields.title ? prefix + '-title-error' : undefined}
            value={form.title}
            onChange={(e) => change('title', e.target.value)}
          />
          {fields.title ? (
            <p id={prefix + '-title-error'} className="field-error">
              {fields.title}
            </p>
          ) : null}
          <label htmlFor={prefix + '-description'}>Описание для сайта</label>
          <textarea
            id={prefix + '-description'}
            name="description"
            maxLength={2000}
            aria-invalid={!!fields.description}
            aria-describedby={fields.description ? prefix + '-description-error' : undefined}
            value={form.description}
            onChange={(e) => change('description', e.target.value)}
          />
          {fields.description ? (
            <p id={prefix + '-description-error'} className="field-error">
              {fields.description}
            </p>
          ) : null}
          <label htmlFor={prefix + '-from'}>Возраст от</label>
          <input
            id={prefix + '-from'}
            name="ageFrom"
            type="number"
            min="0"
            max="120"
            required
            aria-invalid={!!fields.ageFrom}
            aria-describedby={fields.ageFrom ? prefix + '-from-error' : undefined}
            value={form.ageFrom}
            onChange={(e) => change('ageFrom', e.target.value)}
          />
          {fields.ageFrom ? (
            <p id={prefix + '-from-error'} className="field-error">
              {fields.ageFrom}
            </p>
          ) : null}
          <label className="age-directory-option">
            <input
              type="checkbox"
              name="ageOpenEnded"
              checked={form.ageOpenEnded}
              onChange={(e) => change('ageOpenEnded', e.target.checked)}
            />{' '}
            Без верхней границы
          </label>
          {!form.ageOpenEnded ? (
            <>
              <label htmlFor={prefix + '-to'}>Возраст до</label>
              <input
                id={prefix + '-to'}
                name="ageTo"
                type="number"
                min={form.ageFrom || 0}
                max="120"
                required
                value={form.ageTo}
                onChange={(e) => change('ageTo', e.target.value)}
              />
            </>
          ) : null}
          <label htmlFor={prefix + '-order'}>Порядок показа</label>
          <input
            id={prefix + '-order'}
            name="sortOrder"
            type="number"
            min="-2147483648"
            max="2147483647"
            required
            value={form.sortOrder}
            onChange={(e) => change('sortOrder', e.target.value)}
          />
          <label className="age-directory-option">
            <input
              type="checkbox"
              name="active"
              checked={form.active}
              onChange={(e) => change('active', e.target.checked)}
            />{' '}
            Показывать направление на сайте
          </label>
          <p>
            Снятие отметки помещает направление в архив; опубликованные занятия и заявки сохранятся.
          </p>
          <div className="toolbar">
            <button className="button" type="submit" disabled={busy || pending}>
              {busy ? 'Сохранение…' : 'Сохранить'}
            </button>
            <button
              className="button light"
              type="button"
              disabled={busy}
              onClick={() =>
                navigate(() => {
                  setEditing(false);
                  setError('');
                })
              }
            >
              Назад к списку
            </button>
          </div>
        </RussianForm>
      ) : null}
    </div>
  );
}
