import { useEffect, useMemo, useRef, useState } from 'react';
import { reportError } from '../ui/error-feedback';
import {
  useLoaderData,
  useActionData,
  type LoaderFunctionArgs,
  type ActionFunctionArgs,
  Link,
  useLocation,
} from 'react-router';
import { enquiryLoader, enquiryAction } from '../api/enquiry.server';
import { RussianForm } from '../ui/russian-form';
import { PhoneInput } from '../ui/phone-input';
import { uiText } from '../ui/ui-texts';
import { weekdays, weeklyTime } from '../ui/weekly-interval';
import { ENQUIRY_OPTIONS_STEP, type EnquiryOption } from '../ui/enquiry-choice';
export function loader({ request }: LoaderFunctionArgs) {
  return enquiryLoader(request);
}
export function action({ request }: ActionFunctionArgs) {
  return enquiryAction(request);
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function optionLabel(o: EnquiryOption) {
  return { day: weekdays[o.interval.weekday - 1], time: weeklyTime(o.interval) };
}

/**
 * Category filtering works before hydration and without JavaScript through :has(); after
 * hydration React only limits the visible count and clears a choice of another category.
 */
function filterRules(ids: string[]) {
  const form = '.enquiry-form';
  const checked = (id: string) => `input[name="ageDirectionId"][value="${id}"]:checked`;
  return [
    `${form}:not(:has(input[name="ageDirectionId"]:checked)) .enquiry-option[data-direction],` +
      `${form}:not(:has(input[name="ageDirectionId"]:checked)) .enquiry-empty{display:none}`,
    `${form}:has(input[name="ageDirectionId"]:checked) .enquiry-pick-hint{display:none}`,
    ...ids
      .filter((id) => uuid.test(id))
      .map(
        (id) =>
          `${form}:has(${checked(id)}) .enquiry-option[data-direction]:not([data-direction="${id}"]),` +
          `${form}:has(${checked(id)}) .enquiry-empty:not([data-direction="${id}"]){display:none}`,
      ),
  ].join('\n');
}

export default function Enquiry() {
  const loaded = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const view = result ?? loaded;
  const location = useLocation();
  const [hydrated, setHydrated] = useState(false);
  const [category, setCategory] = useState(view.values.ageDirectionId);
  const [choice, setChoice] = useState(view.values.desiredChoice);
  const [shown, setShown] = useState(ENQUIRY_OPTIONS_STEP);
  const [cleared, setCleared] = useState(false);
  const previousView = useRef(view);
  useEffect(() => {
    // Keep a choice made while the server-rendered form was hydrating.
    const checked = (name: string) => document.querySelector<HTMLInputElement>(
      `.enquiry-form input[name="${name}"]:checked`,
    )?.value;
    setCategory(checked('ageDirectionId') ?? view.values.ageDirectionId);
    setChoice(checked('desiredChoice') ?? view.values.desiredChoice);
    setHydrated(true);
  }, []);
  useEffect(() => {
    if (previousView.current === view) return;
    previousView.current = view;
    setCategory(view.values.ageDirectionId);
    setChoice(view.values.desiredChoice);
    setShown(ENQUIRY_OPTIONS_STEP);
    setCleared(false);
  }, [view]);
  useEffect(() => {
    if (result?.error) {
      reportError(result, result.error);
      const invalid = document.querySelector<HTMLElement>('.enquiry-form [aria-invalid="true"]');
      if (invalid) invalid.focus();
      else if (result.open) document.getElementById('session-choice')?.focus();
    }
  }, [result]);
  const directions = view.directions ?? [];
  const options = view.options;
  const byDirection = useMemo(() => {
    const map = new Map<string, EnquiryOption[]>();
    for (const o of options)
      if (o.directionId) map.set(o.directionId, [...(map.get(o.directionId) ?? []), o]);
    return map;
  }, [options]);
  const current = byDirection.get(category) ?? [];
  const selected = options.find((o) => o.choice === choice) ?? null;

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
  const pickCategory = (id: string) => {
    setCategory(id);
    setShown(ENQUIRY_OPTIONS_STEP);
    const own = options.find((o) => o.choice === choice);
    if (own && own.directionId !== id) {
      setChoice('');
      setCleared(true);
    } else setCleared(false);
  };
  return (
    <main id="main" className="page enquiry-page">
      <h1>Заявка на занятие</h1>
      <p>
        Оставьте контакты — администратор свяжется с вами. Регистрация не нужна, заявка не
        резервирует место.
      </p>
      <style>{filterRules(directions.map((d) => d.id))}</style>
      <RussianForm method="post" className="form-card enquiry-form">
        <input type="hidden" name="_csrf" value={view.csrf.token} />
        <input type="hidden" name="commandKey" value={view.key} />
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
        <fieldset className="enquiry-directions" aria-describedby="direction-error">
          <legend>{uiText.enquiryDirectionLegend}</legend>
          {view.directions ? (
            <div className="enquiry-chips">
              {directions.map((d, index) => (
                <label className="enquiry-chip" key={d.id}>
                  <input
                    type="radio"
                    name="ageDirectionId"
                    value={d.id}
                    required
                    checked={category === d.id}
                    onChange={() => pickCategory(d.id)}
                    aria-invalid={index === 0 && !!fields.ageDirectionId ? true : undefined}
                  />
                  <span>{d.title}</span>
                </label>
              ))}
            </div>
          ) : (
            <p className="notice error" role="alert">
              {uiText.enquiryDirectionsUnavailable}{' '}
              <Link to={location.pathname + location.search} reloadDocument>
                {uiText.enquiryRetry}
              </Link>
            </p>
          )}
        </fieldset>
        <p id="direction-error" className="field-error">
          {fields.ageDirectionId}
        </p>
        <label>
          {uiText.enquiryParticipantName}
          <input
            name="participantName"
            maxLength={100}
            defaultValue={view.values.participantName}
            aria-invalid={!!fields.participantName}
            aria-describedby="participant-hint participant-error"
          />
        </label>
        <p id="participant-hint" className="muted field-hint">
          {uiText.enquiryParticipantHint}
        </p>
        <p id="participant-error" className="field-error">
          {fields.participantName}
        </p>
        <details className="enquiry-session-choice" open={view.open || undefined}>
          <summary id="session-choice" tabIndex={-1}>
            <span id="session-choice-title">{uiText.enquiryChoiceSummary}</span>
            {selected && hydrated ? (
              <span className="enquiry-choice-current">
                {uiText.enquiryChoiceSelected}: {optionLabel(selected).day},{' '}
                {optionLabel(selected).time}
              </span>
            ) : null}
          </summary>
          <div className="enquiry-choice-body">
            <p className="muted">{uiText.enquiryChoiceHint}</p>
            {view.notice ? <p className="notice">{view.notice}</p> : null}
            {cleared ? (
              <p className="notice" role="status">
                {uiText.enquiryChoiceCleared}
              </p>
            ) : null}
            {view.listError ? (
              <p className="notice error" role="alert">
                {uiText.enquiryChoiceListError}
              </p>
            ) : null}
            <p className="enquiry-pick-hint">{uiText.enquiryChoicePickDirection}</p>
            <fieldset className="enquiry-options" aria-labelledby="session-choice-title">
              <label className="enquiry-option">
                <input
                  type="radio"
                  name="desiredChoice"
                  value=""
                  checked={choice === ''}
                  onChange={() => setChoice('')}
                />
                <span>{uiText.enquiryChoiceNone}</span>
              </label>
              {options.map((o) => {
                const label = optionLabel(o);
                const position = o.directionId === category ? current.indexOf(o) : -1;
                // Overflow is hidden only once React can offer «Показать ещё».
                const overflow = hydrated && position >= shown && o.choice !== choice;
                return (
                  <label
                    className="enquiry-option"
                    data-direction={o.directionId ?? ''}
                    key={o.choice}
                    hidden={overflow || undefined}
                  >
                    <input
                      type="radio"
                      name="desiredChoice"
                      value={o.choice}
                      checked={choice === o.choice}
                      onChange={() => setChoice(o.choice)}
                    />
                    <span>
                      <strong>
                        {label.day}, {label.time}
                      </strong>
                    </span>
                  </label>
                );
              })}
            </fieldset>
            {!view.listError
              ? directions
                  .filter((d) => !byDirection.has(d.id))
                  .map((d) => (
                    <p className="enquiry-empty muted" data-direction={d.id} key={d.id}>
                      {uiText.enquiryChoiceEmpty}
                    </p>
                  ))
              : null}
            {hydrated && current.length > shown ? (
              <button
                type="button"
                className="button light enquiry-more"
                onClick={() => setShown((value) => value + ENQUIRY_OPTIONS_STEP)}
              >
                {uiText.enquiryChoiceMore}
              </button>
            ) : null}
          </div>
        </details>
        <label>
          Комментарий — необязательно
          <textarea name="comment" maxLength={1000} rows={3} defaultValue={view.values.comment} />
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
        <button className="button" type="submit">
          Отправить заявку
        </button>
      </RussianForm>
    </main>
  );
}
