import { useEffect } from 'react';
import { reportError } from '../ui/error-feedback';
import {
  useLoaderData,
  useActionData,
  type LoaderFunctionArgs,
  type ActionFunctionArgs,
  Link,
} from 'react-router';
import { enquiryLoader, enquiryAction } from '../api/enquiry.server';
import { RussianForm } from '../ui/russian-form';
import { PhoneInput } from '../ui/phone-input';
import { SessionDetails, sessionDays } from '../ui/session-card';
import { choiceValue } from '../ui/schedule-occurrence';
export function loader({ request }: LoaderFunctionArgs) {
  return enquiryLoader(request);
}
export function action({ request }: ActionFunctionArgs) {
  return enquiryAction(request);
}
export default function Enquiry() {
  const loaded = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const view = result ?? loaded;
  useEffect(() => {
    if (result?.error) {
      reportError(result, result.error);
      document.querySelector<HTMLElement>('.enquiry-form [aria-invalid="true"]')?.focus();
    }
  }, [result]);
  if (view.receipt)
    return (
      <main id="main" className="page">
        <h1>Заявка принята</h1>
        <p role="status">
          Номер заявки: {view.receipt.number}. Администратор свяжется с вами для согласования.
        </p>
        <p>Это ещё не подтверждённая запись, место не забронировано.</p>
        <Link to="/#schedule" className="button">
          Посмотреть расписание
        </Link>
      </main>
    );
  const fields = view.fields;
  return (
    <main id="main" className="page enquiry-page">
      <h1>Заявка на занятие</h1>
      <p>
        Оставьте контакты — администратор свяжется с вами. Регистрация не нужна, заявка не
        резервирует место.
      </p>
      <RussianForm method="post" className="form-card enquiry-form">
        <button type="submit" name="intent" value="submit" hidden tabIndex={-1} aria-hidden="true">
          Отправить заявку
        </button>
        <input type="hidden" name="_csrf" value={view.csrf.token} />
        <input type="hidden" name="commandKey" value={view.key} />
        <input type="hidden" name="desiredSessionId" value={view.selectedId} />
        <input type="hidden" name="desiredSessionVersion" value={view.selectedVersion ?? ''} />
        <input type="hidden" name="desiredSeriesId" value={view.selectedRef?.seriesId ?? ''} />
        <input
          type="hidden"
          name="desiredOriginalDate"
          value={view.selectedRef?.originalDate ?? ''}
        />
        <input
          type="hidden"
          name="desiredSeriesVersion"
          value={view.selectedRef?.seriesVersion ?? ''}
        />
        <input type="hidden" name="invalidReference" value={String(view.invalidReference)} />
        <input type="hidden" name="uncertain" value={String(view.uncertain)} />
        <input type="hidden" name="picking" value={String(view.picking)} />
        <input type="hidden" name="page" value={view.page} />
        <label>
          Ваше имя
          <input
            name="parentName"
            required
            maxLength={100}
            autoComplete="name"
            defaultValue={view.values.parentName}
            aria-invalid={!!fields.parentName}
            aria-describedby="parent-error"
          />
        </label>
        <p id="parent-error" className="field-error">
          {fields.parentName}
        </p>
        <PhoneInput
          defaultValue={view.values.phone}
          errorId="phone-error"
          invalid={!!fields.phone}
        />
        <p id="phone-error" className="field-error">
          {fields.phone}
        </p>
        <fieldset className="participant-choice">
          <legend>Для кого занятие</legend>
          <input type="hidden" name="participantType" value={view.values.participantType} />
          <div className="toolbar">
            <button
              type="submit"
              name="intent"
              value="participant-child"
              formNoValidate
              className={view.values.participantType === 'CHILD' ? 'button' : 'button light'}
              aria-pressed={view.values.participantType === 'CHILD'}
            >
              Для ребёнка
            </button>
            <button
              type="submit"
              name="intent"
              value="participant-self"
              formNoValidate
              className={view.values.participantType === 'SELF' ? 'button' : 'button light'}
              aria-pressed={view.values.participantType === 'SELF'}
            >
              Для себя
            </button>
          </div>
        </fieldset>
        {view.values.participantType === 'CHILD' ? (
          <>
            <label>
              Имя ребёнка
              <input
                name="childName"
                required
                maxLength={100}
                defaultValue={view.values.childName}
                aria-invalid={!!fields.childName}
                aria-describedby="child-name-error"
              />
            </label>
            <p id="child-name-error" className="field-error">
              {fields.childName}
            </p>
            <label>
              Возраст ребёнка
              <input
                name="childAge"
                type="number"
                min={0}
                max={17}
                required
                defaultValue={view.values.childAge}
                aria-invalid={!!fields.childAge}
                aria-describedby="child-age-error"
              />
            </label>
            <p id="child-age-error" className="field-error">
              {fields.childAge}
            </p>
            <input type="hidden" name="participantAge" value={view.values.participantAge} />
          </>
        ) : (
          <>
            <label>
              Ваш возраст
              <input
                name="participantAge"
                type="number"
                min={0}
                max={120}
                required
                defaultValue={view.values.participantAge}
                aria-invalid={!!fields.participantAge}
                aria-describedby="participant-age-error"
              />
            </label>
            <p id="participant-age-error" className="field-error">
              {fields.participantAge}
            </p>
            <input type="hidden" name="childName" value={view.values.childName} />
            <input type="hidden" name="childAge" value={view.values.childAge} />
          </>
        )}
        <section className="session-choice" aria-label="Желаемое занятие">
          <h2>Желаемое занятие — необязательно</h2>
          {view.selected ? (
            <>
              <p>
                {new Intl.DateTimeFormat('ru-RU', {
                  timeZone: 'Europe/Moscow',
                  dateStyle: 'full',
                }).format(new Date(view.selected.startsAt)).toLocaleLowerCase('ru-RU')}
              </p>
              <SessionDetails session={view.selected.summary} />
              {view.selectionChanged ? (
                <p className="notice">
                  Условия изменились. Показаны актуальные параметры; подтвердите их перед отправкой.
                </p>
              ) : null}
            </>
          ) : (
            <p>
              {view.selectedId || view.selectedRef || view.invalidReference
                ? 'Выбранное занятие недоступно.'
                : 'Помогите подобрать время'}
            </p>
          )}
          {view.selectionUnavailable ? (
            <p className="notice">Выберите другое занятие или оставьте общую заявку.</p>
          ) : null}
          <div className="toolbar">
            <button
              className="button light"
              type="submit"
              name="intent"
              value="change"
              formNoValidate
            >
              {view.selected ? 'Изменить' : 'Выбрать занятие'}
            </button>
            {view.selectedId || view.selectedRef || view.invalidReference || view.picking ? (
              <button
                className="button light"
                type="submit"
                name="intent"
                value="clear"
                formNoValidate
              >
                Помогите подобрать время
              </button>
            ) : null}
            {view.selectionChanged && !view.selectionUnavailable ? (
              <button className="button" name="intent" value="accept-selection" formNoValidate>
                Выбрать актуальные условия
              </button>
            ) : null}
          </div>
        </section>
        <section
          className={view.picking ? 'session-picker' : 'session-picker picker-collapsed'}
          aria-label="Выбор из расписания"
        >
          <h2>Выберите занятие из расписания</h2>
          <p>
            Время указано по Москве. Возраст группы — рекомендация, условия согласует администратор.
          </p>
          <div className="toolbar">
            <button className="button light" name="intent" value="this-week" formNoValidate>
              Эта неделя
            </button>
            <button className="button light" name="intent" value="following-week" formNoValidate>
              Следующая неделя
            </button>
            <button className="button light" name="intent" value="prev-week" formNoValidate>
              Предыдущая неделя
            </button>
            <label>
              Показать с<input type="date" name="from" defaultValue={view.from} key={view.from} />
            </label>
            <button className="button light" name="intent" value="period" formNoValidate>
              Показать занятия
            </button>
            <button className="button light" name="intent" value="next-week" formNoValidate>
              Следующий период
            </button>
          </div>
          {view.listError ? (
            <p role="alert" className="notice error">
              {view.listError}
            </p>
          ) : null}
          {view.options?.items.length === 0 && view.options.total === 0 ? (
            <p className="notice">
              На выбранную неделю пока нет доступных занятий. Выберите другую неделю или «Помогите
              подобрать время».
            </p>
          ) : null}
          {view.options?.items.length === 0 && view.options.total > 0 ? (
            <p className="notice">На этой странице занятий нет. Вернитесь к предыдущей странице.</p>
          ) : null}
          {sessionDays(view.options?.items ?? []).map((day) => (
            <section key={day.day}>
              <h3>{day.label}</h3>
              {day.sessions.map((s) => (
                <article className="list-card" key={s.key}>
                  <div>
                    <SessionDetails session={s.summary} />
                  </div>
                  <button
                    className="button light"
                    name="intent"
                    value={choiceValue(s)}
                    aria-label={`Выбрать занятие: ${s.summary.title}, ${day.label}`}
                    formNoValidate
                  >
                    Выбрать это занятие
                  </button>
                </article>
              ))}
            </section>
          ))}
          {view.options && (view.options.total > 10 || view.page > 0) ? (
            <div className="toolbar">
              <button
                className="button light"
                name="intent"
                value="prev-page"
                disabled={view.page === 0}
                formNoValidate
              >
                Предыдущие занятия
              </button>
              <p>
                Страница {view.page + 1} из {Math.max(1, Math.ceil(view.options.total / 10))}
              </p>
              <button
                className="button light"
                name="intent"
                value="next-page"
                disabled={(view.page + 1) * 10 >= view.options.total}
                formNoValidate
              >
                Следующие занятия
              </button>
            </div>
          ) : null}
        </section>
        <label>
          Комментарий — необязательно
          <textarea name="comment" maxLength={1000} rows={4} defaultValue={view.values.comment} />
        </label>
        <p className="muted">
          Контакты и сведения заявки получит администратор. Не указывайте диагнозы и другие
          медицинские сведения.
        </p>
        {view.error ? (
          <p className="notice error" role="alert">
            {view.error}
          </p>
        ) : null}
        <button className="button" type="submit" name="intent" value="submit">
          Отправить заявку
        </button>
      </RussianForm>
    </main>
  );
}
