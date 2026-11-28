import { vkError } from './vk-enquiry-settings';
import type { components } from '../api/schema';
import { formatPhone, parsePhone } from './phone';
import { weekdays } from './weekly-interval';
import { moscow } from './workspace';
import './admin-enquiry.css';

type Enquiry = components['schemas']['EnquiryView'];
type Delivery = components['schemas']['DeliveryView'];
type Push = components['schemas']['PushSummary'];

function scheduleSummary(enquiry: Enquiry) {
  const snapshot = enquiry.desiredSessionSnapshot;
  if (!snapshot) return { title: 'Подобрать время', label: 'Занятие', note: '' };
  // Recognize only the published weekly template. Historical and edited snapshots stay intact.
  const match =
    /^Пожелание: ([а-яё]+), ((?:[01]\d|2[0-3]):[0-5]\d–(?:[01]\d|2[0-3]):[0-5]\d(?: \(\+[1-7] дн\.\))? МСК), /u.exec(
      snapshot,
    );
  const day = weekdays.find((name) => name.toLocaleLowerCase('ru') === match?.[1]);
  if (
    match &&
    day &&
    enquiry.ageDirection &&
    snapshot.slice(match[0].length) ===
      enquiry.ageDirection.title + '. Дату согласует администратор.'
  ) {
    return {
      title: day + ', ' + match[2],
      label: 'Пожелание по расписанию',
      note: 'Дату первого занятия нужно согласовать.',
    };
  }
  return { title: snapshot, label: 'Выбор занятия', note: '' };
}

function displayedPhone(phone: string) {
  const digits = parsePhone(phone);
  return digits ? '+7 ' + formatPhone(digits) : phone;
}

export function EnquiryRow({ value, open }: { value: Enquiry; open: () => void }) {
  const summary = scheduleSummary(value);
  return (
    <article className="enquiry-row">
      <div className="enquiry-row-person">
        <strong>{value.parentName}</strong>
        <span>{displayedPhone(value.phone)}</span>
      </div>
      <div className="enquiry-row-slot">
        <strong>{summary.title}</strong>
        {value.ageDirection && <span>{value.ageDirection.title}</span>}
      </div>
      <div className="enquiry-row-meta">
        <h2>Заявка №{value.number}</h2>
        <time dateTime={value.createdAt}>{moscow(value.createdAt)}</time>
      </div>
      <button
        type="button"
        className="enquiry-row-open"
        aria-label={`Открыть заявку №${value.number}`}
        onClick={(event) => {
          event.currentTarget.focus({ preventScroll: true });
          open();
        }}
      >
        <span aria-hidden="true">›</span>
      </button>
    </article>
  );
}

function telegramStatus(delivery: Delivery | null) {
  if (!delivery) return 'Проверяем…';
  if (delivery.status === 'NOT_SELECTED') return 'Канал не был выбран';
  if (delivery.status === 'DELIVERED') return 'Доставлено';
  if (delivery.status === 'STOPPED') return 'Остановлено. Канал отключён.';
  return delivery.status === 'FAILED' ? 'Не удалось доставить' : 'Ожидало отправки';
}

function vkStatus(delivery: components['schemas']['VkDeliveryView'] | null) {
  if (!delivery) return 'Проверяем…';
  switch (delivery.status) {
    case 'NOT_SELECTED':
      return 'Канал не был выбран';
    case 'DELIVERED':
      return 'Принято ВКонтакте';
    case 'SENDING':
      return 'Отправляем…';
    case 'STOPPED':
      return delivery.error ? vkError(delivery.error) : 'Отправка остановлена';
    case 'FAILED':
      return delivery.error ? vkError(delivery.error) : 'Не удалось доставить';
    default:
      return 'Ожидает отправки';
  }
}

function pushStatus(push: Push | null) {
  if (!push) return 'Проверяем…';
  if (!push.selected) return 'Канал не был выбран';
  if (!push.configured) return 'Сервис не настроен';
  if (!push.subscriptions) return 'Нет подключённых устройств';
  return `Принято сервисом: ${push.accepted}. Ожидают: ${push.waiting}. Ошибки или отключения: ${push.failed}. Показ не подтверждён.`;
}

export function EnquiryDetails({
  value,
  delivery,
  vk,
  vkLoadError,
  push,
  telegramError,
  pushError,
  retry,
  preparePayment,
}: {
  value: Enquiry;
  delivery: Delivery | null;
  vk: components['schemas']['VkDeliveryView'] | null;
  vkLoadError: string;
  push: Push | null;
  telegramError: string;
  pushError: string;
  retry: () => void;
  preparePayment?: () => void;
}) {
  const summary = scheduleSummary(value);
  const digits = parsePhone(value.phone);
  const attention =
    !!telegramError ||
    !!vkLoadError ||
    !!pushError ||
    vk?.status === 'FAILED' ||
    vk?.status === 'STOPPED' ||
    !!push?.failed;
  return (
    <div className="enquiry-details">
      <time className="enquiry-created" dateTime={value.createdAt}>
        {moscow(value.createdAt)}
      </time>
      <div className="enquiry-contact">
        <div>
          <h3>{value.parentName}</h3>
          <span className="enquiry-phone">{displayedPhone(value.phone)}</span>
        </div>
        {digits && (
          <a
            className="enquiry-call"
            href={'tel:+7' + digits}
            aria-label={'Позвонить по номеру ' + displayedPhone(value.phone)}
          >
            <svg
              aria-hidden="true"
              width="17"
              height="17"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinejoin="round"
            >
              <path d="m7 3 3 5-2.2 2.3a15 15 0 0 0 5.9 5.9L16 14l5 3-1 4C11 22 2 13 3 4Z" />
            </svg>
            Позвонить
          </a>
        )}
      </div>
      <div className="enquiry-intent">
        <h4>{summary.label}</h4>
        <p className="enquiry-slot">{summary.title}</p>
        {value.ageDirection && (
          <p className="enquiry-age">Возрастная категория · {value.ageDirection.title}</p>
        )}
        {summary.note && <p className="enquiry-intent-note">{summary.note}</p>}
      </div>
      {value.participantName && (
        <div className="enquiry-field">
          <h4>Кто будет заниматься</h4>
          <p>{value.participantName}</p>
        </div>
      )}
      {value.participantType === 'SELF' && (
        <p>Для себя{value.participantAge != null && `, возраст: ${value.participantAge}`}</p>
      )}
      {(value.childName || value.childAge != null) && (
        <div className="enquiry-field">
          <h4>Ребёнок</h4>
          <p>
            {value.childName ?? 'Имя ребёнка не указано'}
            {value.childAge != null && `, возраст: ${value.childAge}`}
          </p>
        </div>
      )}
      {value.comment && (
        <div className="enquiry-field">
          <h4>Комментарий</h4>
          <p>{value.comment}</p>
        </div>
      )}
      <details className="enquiry-delivery">
        <summary>Доставка уведомлений{attention && <span>Требует внимания</span>}</summary>
        <dl>
          <div>
            <dt>ВКонтакте</dt>
            <dd>{vkLoadError ? <span role="alert">{vkLoadError}</span> : vkStatus(vk)}</dd>
          </div>
          {(telegramError || (delivery && delivery.status !== 'NOT_SELECTED')) && (
            <div>
              <dt>Telegram · история</dt>
              <dd>
                {telegramError ? (
                  <span role="alert">{telegramError}</span>
                ) : (
                  telegramStatus(delivery)
                )}
              </dd>
            </div>
          )}
          <div>
            <dt>Уведомления браузера</dt>
            <dd>{pushError ? <span role="alert">{pushError}</span> : pushStatus(push)}</dd>
          </div>
        </dl>
        {vk?.canRetry && (
          <button type="button" className="button light" onClick={retry}>
            Повторить отправку во ВКонтакте
          </button>
        )}
      </details>
      {preparePayment && (
        <div className="enquiry-payment">
          <button type="button" onClick={preparePayment}>
            Подготовить оплату
          </button>
        </div>
      )}
    </div>
  );
}
