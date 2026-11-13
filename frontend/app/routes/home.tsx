import { ScheduleSection } from '../ui/schedule-section';
import { useLoaderData, useRouteLoaderData } from 'react-router';
import type { loader as rootLoader } from '../root';
import type { components } from '../api/schema';
import { BookingLink } from '../ui/booking-link';

type Block = components['schemas']['LandingBlock'];

const formatPhotos = [
  { file: 'mini-group-v2.webp', width: 1344, height: 704, alt: 'Групповое занятие с тренером' },
  { file: 'individual.webp', width: 1600, height: 900, alt: 'Упражнения на занятии' },
  { file: 'hero.webp', width: 1600, height: 900, alt: 'Дети занимаются гимнастикой с тренером' },
] as const;

type AgeDirection = { id: string; title: string; description: string };

export async function loader(): Promise<{ ages: AgeDirection[] | null }> {
  try {
    const base = process.env.BACKEND_INTERNAL_URL ?? 'http://127.0.0.1:8080/lastochka';
    const response = await fetch(`${base}/api/v1/public/age-directions`, {
      signal: AbortSignal.timeout(4000),
    });
    if (!response.ok) return { ages: null };
    const value: unknown = await response.json();
    if (!value || typeof value !== 'object' || !('items' in value) || !Array.isArray(value.items))
      return { ages: null };
    const valid = value.items.every(
      (item: unknown) =>
        item &&
        typeof item === 'object' &&
        'id' in item &&
        typeof item.id === 'string' &&
        'title' in item &&
        typeof item.title === 'string' &&
        'description' in item &&
        typeof item.description === 'string',
    );
    return { ages: valid ? (value.items as AgeDirection[]) : null };
  } catch {
    return { ages: null };
  }
}

function blockItems(block: Block) {
  return (block.items ?? []).map((item) => {
    const [title, ...text] = item.split('|');
    return { title, text: text.join('|') };
  });
}

function updateKnown(value: string, oldValue: string, newValue: string) {
  return value === oldValue ? newValue : value;
}

function Scene({ block: b, phone }: { block: Block; phone: string }) {
  const items = blockItems(b);
  if (b.kind === 'hero') {
    const audience = b.items ?? [];
    const oldAudience = ['Белгород', 'Дети 5–14 лет'];
    const newAudience = ['Белгород', 'Дети от 3 лет', 'подростки и взрослые'];
    const isOldAudience =
      audience.length === oldAudience.length &&
      audience.every((item, i) => item === oldAudience[i]);
    const displayedAudience = isOldAudience ? newAudience : audience;
    const title = updateKnown(
      b.title,
      'Двигаться легко. Расти уверенно.',
      'Гимнастика для детей и взрослых',
    );
    const description = updateKnown(
      b.text,
      'Оздоровительная гимнастика для осанки, сильной спины и радости движения. В маленькой группе, с большим вниманием к каждому.',
      'Движение, игра и упражнения в комфортном темпе. Подберём занятия по возрасту и уровню подготовки.',
    );
    return (
      <section className="landing-hero" id={b.id}>
        <div className="landing-hero-copy">
          {displayedAudience.length > 0 ? (
            <p className="landing-location">{displayedAudience.join(' · ')}</p>
          ) : null}
          <h1>{title}</h1>
          <p className="landing-intro">{description}</p>
          <div className="landing-actions">
            <BookingLink className="button">Хочу на первое занятие</BookingLink>
            <a className="landing-inline-link" href="#schedule">
              Посмотреть расписание
            </a>
          </div>
        </div>
        <figure className="landing-hero-photo">
          <img
            src={`${import.meta.env.BASE_URL}images/${b.image || 'hero.webp'}`}
            alt={updateKnown(
              b.alt || 'Дети занимаются гимнастикой с тренером',
              'Иллюстрация занятия детей с тренером в светлом зале',
              'Дети занимаются гимнастикой с тренером',
            )}
            width="1600"
            height="900"
            fetchPriority="high"
          />
        </figure>
      </section>
    );
  }
  if (b.kind === 'approach') {
    return (
      <section className="landing-section landing-approach" id={b.id}>
        <div className="landing-section-intro">
          <p className="landing-kicker">Наш подход</p>
          <h2>{b.title}</h2>
          <p>{b.text}</p>
        </div>
        <div className="landing-approach-list">
          {items.map((item) => (
            <article key={item.title}>
              <h3>{item.title}</h3>
              <p>{item.text}</p>
            </article>
          ))}
        </div>
      </section>
    );
  }
  if (b.kind === 'formats') {
    return (
      <section className="landing-section landing-formats" id={b.id}>
        <div className="landing-section-intro">
          <p className="landing-kicker">Форматы</p>
          <h2>{b.title}</h2>
          <p>{b.text}</p>
        </div>
        <div className="landing-formats-list">
          {items.map((item, index) => {
            const photo = formatPhotos[index] ?? formatPhotos[0];
            return (
              <article key={item.title}>
                <img
                  src={`${import.meta.env.BASE_URL}images/${photo.file}`}
                  alt={photo.alt}
                  width={photo.width}
                  height={photo.height}
                  loading="lazy"
                />
                <h3>{item.title}</h3>
                <p>{item.text}</p>
                <BookingLink className="landing-inline-link">Выбрать занятие</BookingLink>
              </article>
            );
          })}
        </div>
      </section>
    );
  }
  if (b.kind === 'steps') {
    return (
      <section className="landing-section landing-visit" id={b.id}>
        <div className="landing-section-intro">
          <p className="landing-kicker">Первое посещение</p>
          <h2>{updateKnown(b.title, 'Начнём со знакомства.', 'Первое занятие')}</h2>
          <p>
            {updateKnown(
              b.text,
              'Первое занятие — без лишнего волнения.',
              'Познакомьтесь со студией и тренером, попробуйте упражнения и посмотрите, подходит ли вам или вашему ребёнку формат занятий. Уточните у администратора условия бесплатного первого занятия.',
            )}
          </p>
          <BookingLink className="button">Записаться на первое занятие</BookingLink>
        </div>
        <ol>
          {items.map((item, i) => {
            const text = updateKnown(
              updateKnown(
                updateKnown(
                  item.text,
                  'Создайте аккаунт родителя и добавьте ребёнка.',
                  'Оставьте контакты — администратор свяжется с вами.',
                ),
                'Администратор подтвердит запись. Возьмите удобную форму и воду.',
                'Согласуйте занятие с администратором. Возьмите удобную форму и воду.',
              ),
              'Укажите имя и телефон родителя, имя и возраст ребёнка. Администратор свяжется с вами.',
              'Укажите имя, телефон и возраст участника. Администратор свяжется с вами.',
            );
            return (
              <li key={item.title}>
                <span aria-hidden="true">{i + 1}</span>
                <div>
                  <h3>{item.title}</h3>
                  <p>{text}</p>
                </div>
              </li>
            );
          })}
        </ol>
      </section>
    );
  }
  if (b.kind === 'coach') {
    return (
      <section className="landing-section landing-coach" id={b.id}>
        <figure className="landing-coach-photo">
          <img
            src={`${import.meta.env.BASE_URL}images/${b.image || 'coach.webp'}`}
            alt={updateKnown(
              b.alt || 'Портрет тренера',
              'Иллюстрация тренера; изображение из дизайн-концепции',
              'Портрет тренера',
            )}
            width="1122"
            height="1402"
            loading="lazy"
          />
        </figure>
        <div className="landing-coach-copy">
          <p className="landing-kicker">Тренер и основатель</p>
          <h2>{b.title}</h2>
          <p>{b.text}</p>
        </div>
      </section>
    );
  }
  if (b.kind === 'faq') {
    return (
      <section className="landing-section landing-faq" id={b.id}>
        <div className="landing-section-intro">
          <p className="landing-kicker">Полезно знать</p>
          <h2>{b.title}</h2>
          <p>{b.text}</p>
        </div>
        <div>
          {items.map((item) => {
            const knownAnswers: Record<string, string> = {
              'Программа студии рассчитана на детей 5–14 лет. Подходящий формат поможет выбрать тренер.':
                'В студии есть направления для детей от 3 лет, подростков и взрослых. Поможем подобрать подходящую группу.',
              'Да. Добавьте карточки детей в кабинете и отправьте отдельную заявку для каждого.':
                'Да. Оставьте отдельную заявку для каждого ребёнка — администратор поможет подобрать занятия.',
              'После одобрения администратором. Статус заявки виден в кабинете.':
                'Администратор свяжется с вами и согласует занятие. Заявка сама по себе не резервирует место.',
              'Студия в Белгороде. Точный адрес, действующие цены и условия первого посещения уточните у тренера.':
                'Студия находится в Белгороде. Точный адрес и условия первого посещения уточните у администратора; стоимость занятий указана на сайте.',
            };
            const answer = knownAnswers[item.text] ?? item.text;
            return (
              <details key={item.title}>
                <summary>
                  {item.title}
                  <span aria-hidden="true">+</span>
                </summary>
                <p>{answer}</p>
              </details>
            );
          })}
        </div>
      </section>
    );
  }
  if (b.kind === 'contacts') {
    const text = updateKnown(
      b.text,
      'Белгород. Точный адрес, стоимость и подходящий формат подскажем при знакомстве.',
      'Приходите на первое занятие — поможем выбрать подходящую группу. Адрес и время подскажем при согласовании.',
    );
    return (
      <section className="landing-section landing-contacts" id={b.id}>
        <div>
          <p className="landing-kicker">Будем рады знакомству</p>
          <h2>{b.title}</h2>
          <p>{text}</p>
        </div>
        <div className="landing-contacts-actions">
          <BookingLink className="button">Записаться на занятие</BookingLink>
          <a className="landing-inline-link" href="https://vk.ru/lastochkagym">
            Сообщество ВКонтакте
          </a>
          <a className="landing-contact-phone" href={'tel:' + phone.replace(/[^+\d]/g, '')}>
            {phone}
          </a>
        </div>
      </section>
    );
  }
  return null;
}

function AgeGroups({ ages }: { ages: AgeDirection[] | null }) {
  return (
    <section className="landing-section landing-ages" id="age-groups">
      <div className="landing-section-intro">
        <p className="landing-kicker">Возрастные направления</p>
        <h2>Занятия для каждого возраста</h2>
        <p>Поможем подобрать группу, в которой будет комфортно заниматься.</p>
      </div>
      {ages === null ? (
        <p role="status">
          Не удалось загрузить возрастные направления. Попробуйте обновить страницу или оставьте
          заявку — поможем подобрать занятие.
        </p>
      ) : ages.length === 0 ? (
        <p>Возрастные направления уточняются. Оставьте заявку — поможем подобрать занятие.</p>
      ) : (
        <div className="landing-age-list">
          {ages.map((item) => (
            <article key={item.id}>
              <h3>{item.title}</h3>
              <p>{item.description}</p>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function Prices() {
  return (
    <section className="landing-section landing-prices" id="prices">
      <div className="landing-section-intro">
        <p className="landing-kicker">Стоимость</p>
        <h2>Занятия и абонемент</h2>
      </div>
      <div className="landing-price-list">
        <article>
          <div>
            <h3>Абонемент на 4 недели</h3>
            <p>8 занятий · 2 раза в неделю</p>
          </div>
          <strong>6 400 ₽</strong>
        </article>
        <article>
          <div>
            <h3>Разовое занятие</h3>
          </div>
          <strong>950 ₽</strong>
        </article>
        <article>
          <div>
            <h3>Индивидуальное занятие</h3>
          </div>
          <strong>2 000 ₽</strong>
        </article>
        <BookingLink className="landing-inline-link">Подобрать занятие</BookingLink>
      </div>
    </section>
  );
}

export default function Home() {
  const data = useRouteLoaderData<typeof rootLoader>('root');
  const { ages } = useLoaderData<typeof loader>();
  if (!data) throw new Response('Контент недоступен', { status: 503 });
  const blocks = data.blocks.filter((block) => block.visible !== false);
  const formats = blocks.reduce((last, block, i) => (block.kind === 'formats' ? i : last), -1);
  let insertion = formats + 1;
  if (formats === -1) {
    insertion = blocks.findIndex((block) => block.kind === 'steps');
    if (insertion === -1) insertion = blocks.findIndex((block) => block.kind === 'contacts');
    if (insertion === -1) insertion = blocks.length;
  }
  const sections = blocks.map((block) => <Scene key={block.id} block={block} phone={data.phone} />);
  sections.splice(insertion, 0, <Prices key="prices" />, <ScheduleSection key="public-schedule" />);
  const beforeFormats = formats < 0 ? Math.min(insertion, sections.length) : formats;
  sections.splice(beforeFormats, 0, <AgeGroups key="age-groups" ages={ages} />);
  return (
    <main id="main" className="landing-refresh">
      {sections}
    </main>
  );
}
