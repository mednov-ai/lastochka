import { ScheduleFrame } from '../ui/schedule-section';
import { Suspense } from 'react';
import { Await, useLoaderData, useRouteLoaderData, type LoaderFunctionArgs } from 'react-router';
import createClient from 'openapi-fetch';
import type { paths } from '../api/schema';
import { WeeklyPoster } from '../ui/weekly-schedule';
import type { WeeklySchedule } from '../ui/weekly-interval';
import type { loader as rootLoader } from '../root';
import type { components } from '../api/schema';
import { BookingLink } from '../ui/booking-link';
import { useLandingMotion } from '../ui/landing-motion';
import { AgeFigures } from '../ui/age-figures';
import { Phrase, Words } from '../ui/words';
import '../ui/landing-motion.css';

type Block = components['schemas']['LandingBlock'];

const formatPhotos = [
  { file: 'mini-group-v2.webp', width: 1344, height: 704, alt: 'Групповое занятие с тренером' },
  { file: 'individual.webp', width: 1600, height: 900, alt: 'Упражнения на занятии' },
  { file: 'hero.webp', width: 1600, height: 900, alt: 'Дети занимаются гимнастикой с тренером' },
] as const;

// The streamed initial schedule is time-sensitive and must not be replayed by shared caches.
export function headers() {
  return { 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' };
}

export function loader(_: LoaderFunctionArgs) {
  const client = createClient<paths>({
    baseUrl: process.env.BACKEND_INTERNAL_URL ?? 'http://127.0.0.1:8080/lastochka',
  });
  const schedule = client
    .GET('/api/v1/public/schedule/weekly', { signal: AbortSignal.timeout(3500) })
    .then(
      (result) => result.data ?? null,
      () => null,
    );
  return { schedule };
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

function Scene({ block: b, phone, email }: { block: Block; phone: string; email?: string | null }) {
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
      'Гимнастика для детей и взрослых',
      'Двигаться легко. Расти уверенно.',
    );
    // The client asked for the earlier intro back; content saved by V24 still holds the replacement.
    const description = updateKnown(
      b.text,
      'Движение, игра и упражнения в комфортном темпе. Подберём занятия по возрасту и уровню подготовки.',
      'Оздоровительная гимнастика для осанки, сильной спины и радости движения. В маленькой группе, с большим вниманием к каждому.',
    );
    return (
      <section
        className="landing-hero"
        id={b.id}
        data-motion={b.motionPreset === 'hero-reveal' ? b.motionPreset : undefined}
      >
        <div className="landing-hero-copy">
          {displayedAudience.length > 0 ? (
            <p className="landing-location">{displayedAudience.join(' · ')}</p>
          ) : null}
          <h1>
            <Words text={title} />
          </h1>
          <p className="landing-intro">{description}</p>
          <div className="landing-actions">
            <BookingLink className="button">
              Хочу на первое занятие <span aria-hidden="true">↗</span>
            </BookingLink>
            <a className="landing-inline-link" href="#schedule">
              Посмотреть расписание
            </a>
          </div>
          <p className="landing-hero-note">В своём темпе. С поддержкой тренера.</p>
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
      <section
        className="landing-section landing-approach approach"
        id={b.id}
        data-motion={b.motionPreset === 'approach-story' ? b.motionPreset : undefined}
      >
        <div className="landing-section-intro">
          <p className="landing-kicker">Наш подход</p>
          <h2>
            <Words text={b.title} />
          </h2>
          <p>{b.text}</p>
        </div>
        <div className="approach-grid">
          {items.map((item, index) => (
            <article key={item.title}>
              <span className="number">
                <span className="number-orb">
                  <span className="number-value">{String(index + 1).padStart(2, '0')}</span>
                </span>
              </span>
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
      <section
        className="landing-section landing-formats"
        id={b.id}
        data-motion={b.motionPreset === 'formats-reveal' ? b.motionPreset : undefined}
      >
        <div className="landing-section-intro">
          <p className="landing-kicker">Форматы занятий</p>
          <h2>
            <Words text={b.title} />
          </h2>
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
                <h3>
                  <BookingLink className="landing-inline-link">{item.title}</BookingLink>
                </h3>
                <p>{item.text}</p>
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
          <h2>
            <Words text={updateKnown(b.title, 'Первое занятие', 'Начнём со знакомства.')} />
          </h2>
          <p>
            {[
              'Первое занятие — без лишнего волнения.',
              'Познакомьтесь со студией и тренером, попробуйте упражнения и посмотрите, подходит ли вам или вашему ребёнку формат занятий. Уточните у администратора условия бесплатного первого занятия.',
            ].includes(b.text)
              ? 'Первое занятие — без лишнего волнения.'
              : b.text}
          </p>
          <p>Первое занятие бесплатно.</p>
          <BookingLink className="button">Записаться на первое занятие</BookingLink>
        </div>
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
          <h2>
            <Words text={b.title} />
          </h2>
          <p>{b.text}</p>
          <p className="landing-coach-note">
            <Phrase text="Внимательное знакомство с движением начинается с доверия." />
          </p>
        </div>
      </section>
    );
  }
  if (b.kind === 'faq') {
    return (
      <section className="landing-section landing-faq" id={b.id}>
        <div className="landing-section-intro">
          <p className="landing-kicker">Частые вопросы</p>
          <h2>
            <Words text={b.title} />
          </h2>
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
                'Мы находимся по адресу: г. Белгород, ул. Щорса, 8Д, ТЦ «Атлас», 2 этаж. Стоимость занятий указана на сайте.',
              'Студия находится в Белгороде. Точный адрес и условия первого посещения уточните у администратора; стоимость занятий указана на сайте.':
                'Мы находимся по адресу: г. Белгород, ул. Щорса, 8Д, ТЦ «Атлас», 2 этаж. Стоимость занятий указана на сайте.',
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
          <p className="landing-kicker">Сделаем первый шаг вместе</p>
          <h2>
            <Words text={b.title} />
          </h2>
          {text !==
            'Приходите на первое занятие — поможем выбрать подходящую группу. Адрес и время подскажем при согласовании.' && (
            <p>{text}</p>
          )}
        </div>
        <div className="landing-contacts-actions">
          <BookingLink className="button">Записаться на занятие</BookingLink>
          <a className="landing-inline-link" href="https://vk.ru/lastochkagym">
            Сообщество ВКонтакте
          </a>
          <a className="landing-contact-phone" href={'tel:' + phone.replace(/[^+\d]/g, '')}>
            {phone}
          </a>
          {email ? (
            <a className="landing-inline-link" href={'mailto:' + email} translate="no">
              {email}
            </a>
          ) : null}
        </div>
      </section>
    );
  }
  return null;
}

function AgeGroups({ schedule }: { schedule: Promise<WeeklySchedule | null> }) {
  return (
    <section className="landing-section landing-ages" id="age-groups">
      <div className="landing-section-intro">
        <p className="landing-kicker">Возрастные направления</p>
        <h2>
          <Words text="Занятия для каждого возраста" />
        </h2>
        <p>
          Поможем подобрать группу, в которой будет комфортно заниматься. Ведь каждый возраст имеет
          свои особенности физического развития, и мы это учитываем. Мы не просто делим детей по
          возрасту, а подбираем ту нагрузку и тот формат общения, которые будут правильными и
          уместными именно сейчас.
        </p>
      </div>
      <div className="ages-art" aria-hidden="true">
        <Suspense fallback={<AgeFigures />}>
          <Await resolve={schedule}>{(data) => <AgeFigures directions={data?.directions} />}</Await>
        </Suspense>
      </div>
    </section>
  );
}

function Prices() {
  return (
    <section className="landing-section landing-prices" id="prices">
      <div className="landing-section-intro">
        <p className="landing-kicker">Стоимость</p>
        <h2>
          <Words text="Занятия и абонемент" />
        </h2>
      </div>
      <div className="landing-price-list">
        <section aria-label="Мини-группа">
          <h3>Мини-группа</h3>
          <article>
            <div>
              <h4>Абонемент на 4 недели</h4>
              <p>8 занятий · 2 раза в неделю</p>
            </div>
            <strong>6 400 ₽</strong>
          </article>
          <article>
            <div>
              <h4>Разовое занятие</h4>
            </div>
            <strong>950 ₽</strong>
          </article>
        </section>
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
  const { schedule } = useLoaderData<typeof loader>();
  const [motionRoot, ribbon] = useLandingMotion(data?.revision ?? 0);
  if (!data) throw new Response('Контент недоступен', { status: 503 });
  const blocks = data.blocks.filter((block) => block.visible !== false);
  const formats = blocks.reduce((last, block, i) => (block.kind === 'formats' ? i : last), -1);
  let insertion = formats + 1;
  if (formats === -1) {
    insertion = blocks.findIndex((block) => block.kind === 'steps');
    if (insertion === -1) insertion = blocks.findIndex((block) => block.kind === 'contacts');
    if (insertion === -1) insertion = blocks.length;
  }
  const sections = blocks.map((block) => (
    <Scene key={block.id} block={block} phone={data.phone} email={data.email} />
  ));
  sections.splice(
    insertion,
    0,
    <Prices key="prices" />,
    <ScheduleFrame key="public-schedule">
      <Suspense fallback={<p role="status">Загружаем расписание…</p>}>
        <Await resolve={schedule}>{(initial) => <WeeklyPoster initial={initial} />}</Await>
      </Suspense>
    </ScheduleFrame>,
  );
  const beforeFormats = formats < 0 ? Math.min(insertion, sections.length) : formats;
  sections.splice(beforeFormats, 0, <AgeGroups key="age-groups" schedule={schedule} />);
  return (
    <main ref={motionRoot} id="main" className="landing-refresh">
      <canvas ref={ribbon} className="landing-ribbon" aria-hidden="true" />
      {sections}
    </main>
  );
}
