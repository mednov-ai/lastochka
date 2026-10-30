import { ScheduleSection } from '../ui/schedule-section';
import { SectionLink } from '../ui/section-link';
import type { Route } from './+types/home';
import { Link, useRouteLoaderData } from 'react-router';
import type { loader as rootLoader } from '../root';
import createClient from 'openapi-fetch';
import type { paths, components } from '../api/schema';
import type { CSSProperties } from 'react';
import { useLandingMotion } from '../ui/landing-motion';
import { BookingLink } from '../ui/booking-link';
type Block = components['schemas']['LandingBlock'];
function Arrow() {
  return <span aria-hidden="true">↗</span>;
}
const presets = new Set(['hero-reveal', 'approach-story', 'formats-reveal']);
const formatIllustrations = [
  { file: 'mini-group-v2.webp', width: 1344, height: 704 },
  { file: 'individual.webp', width: 1600, height: 900 },
  { file: 'hero.webp', width: 1600, height: 900 },
] as const;
function Scene({ block: b, phone, telegram }: { block: Block; phone: string; telegram: string }) {
  const props = {
    id: b.id,
    'data-motion': presets.has(b.motionPreset ?? '') ? b.motionPreset : undefined,
  };
  const items = (b.items ?? []).map((v) => {
    const [title, text] = v.split('|');
    return { title, text };
  });
  if (b.kind === 'hero')
    return (
      <section className="hero" {...props}>
        <div className="hero-copy">
          <p className="eyebrow">
            <span aria-hidden="true">⌖</span> {(b.items ?? []).join(' · ')}
          </p>
          <h1>
            {b.title.split('. ')[0]}.<br />
            <em>{b.title.split('. ').slice(1).join('. ')}</em>
          </h1>
          <p className="lead">{b.text}</p>
          <div className="hero-cta">
            <BookingLink className="button">
              Хочу на первое занятие <Arrow />
            </BookingLink>
            <a className="text-link" href="#approach">
              Как проходят занятия <Arrow />
            </a>
          </div>
          <p className="quiet">
            <span className="sun" aria-hidden="true">
              ☼
            </span>{' '}
            В своём темпе. С поддержкой тренера.
          </p>
        </div>
        <figure className="hero-visual">
          <div className="halo" />
          <div className="hero-media">
            <img
              src={`${import.meta.env.BASE_URL}images/${b.image}`}
              width="720"
              height="760"
              alt={b.alt ?? ''}
              fetchPriority="high"
            />
          </div>
          <svg className="swirl" viewBox="0 0 100 160" aria-hidden="true">
            <path pathLength="1" d="M5 155C110 100 40-10 26 30S5 90 95 52" />
          </svg>
          <figcaption>
            <span aria-hidden="true">✧</span> Маленькие шаги.
            <br />
            Большая уверенность.
          </figcaption>
        </figure>
      </section>
    );
  if (b.kind === 'approach')
    return (
      <section className="section approach" {...props}>
        <div className="section-heading">
          <p className="eyebrow">НАШ ПОДХОД</p>
          <h2>{b.title}</h2>
          <p>{b.text}</p>
        </div>
        <div className="approach-grid">
          <svg
            className="thread"
            viewBox="0 0 1000 140"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <path
              className="thread-track"
              vectorEffect="non-scaling-stroke"
              d="M4 110C150 18 350 18 500 110C650 18 850 18 996 110"
            />
            <path
              className="thread-progress"
              vectorEffect="non-scaling-stroke"
              pathLength="1"
              d="M4 110C150 18 350 18 500 110C650 18 850 18 996 110"
            />
          </svg>
          {items.map((item, i) => (
            <article key={item.title} style={{ '--index': i } as CSSProperties}>
              <span className="number">
                <span className="number-orb">
                  <span className="number-value">0{i + 1}</span>
                </span>
              </span>
              <h3>{item.title}</h3>
              <p>{item.text}</p>
            </article>
          ))}
        </div>
      </section>
    );
  if (b.kind === 'formats')
    return (
      <section className="section formats" {...props}>
        <div className="section-heading">
          <p className="eyebrow">ФОРМАТЫ ЗАНЯТИЙ</p>
          <h2>{b.title}</h2>
          <p>{b.text}</p>
        </div>
        <div className="card-grid">
          {items.map((item, i) => {
            const image = formatIllustrations[i] ?? formatIllustrations[0];
            return (
              <article
                className="format-card"
                key={item.title}
                style={{ '--index': i } as CSSProperties}
              >
                <div className={`format-art art-${i}`}>
                  <img
                    src={`${import.meta.env.BASE_URL}images/${image.file}`}
                    width={image.width}
                    height={image.height}
                    alt={`Иллюстрация: ${item.title}`}
                    loading="lazy"
                  />
                  <span>0{i + 1}</span>
                </div>
                <div className="card-body">
                  <h3>{item.title}</h3>
                  <p>{item.text}</p>
                  <BookingLink className="text-link">
                    Выбрать занятие <Arrow />
                  </BookingLink>
                </div>
              </article>
            );
          })}
        </div>
      </section>
    );
  if (b.kind === 'steps')
    return (
      <section className="section steps" {...props}>
        <div>
          <p className="eyebrow">ПЕРВОЕ ПОСЕЩЕНИЕ</p>
          <h2>{b.title}</h2>
          <p>{b.text}</p>
          <SectionLink to="/#schedule" className="button">
            Посмотреть расписание <Arrow />
          </SectionLink>
        </div>
        <ol>
          {items.map((it, i) => (
            <li key={it.title}>
              <span>0{i + 1}</span>
              <div>
                <h3>{it.title}</h3>
                <p>{it.text}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>
    );
  if (b.kind === 'coach')
    return (
      <section className="section coach" {...props}>
        <figure>
          <img
            src={`${import.meta.env.BASE_URL}images/${b.image}`}
            width="1122"
            height="1402"
            alt={
              b.alt === 'Иллюстрация тренера; изображение из дизайн-концепции'
                ? 'Иллюстрация тренера'
                : (b.alt ?? 'Иллюстрация тренера')
            }
            loading="lazy"
          />
        </figure>
        <div>
          <p className="eyebrow">ТРЕНЕР И ОСНОВАТЕЛЬ</p>
          <h2>{b.title}</h2>
          <p className="lead">{b.text}</p>
          <p className="coach-note">Внимательное знакомство с движением начинается с доверия.</p>
          <a href={'https://t.me/' + encodeURIComponent(telegram)} className="text-link">
            Познакомиться с тренером <Arrow />
          </a>
        </div>
      </section>
    );
  if (b.kind === 'faq')
    return (
      <section className="section faq" {...props}>
        <div className="section-heading">
          <p className="eyebrow">ЧАСТЫЕ ВОПРОСЫ</p>
          <h2>{b.title}</h2>
          <p>{b.text}</p>
        </div>
        <div>
          {items.map((it) => (
            <details key={it.title}>
              <summary>
                {it.title}
                <span aria-hidden="true">+</span>
              </summary>
              <p>{it.text}</p>
            </details>
          ))}
        </div>
      </section>
    );
  if (b.kind === 'contacts')
    return (
      <section className="section contacts" {...props}>
        <span className="eyebrow">СДЕЛАЕМ ПЕРВЫЙ ШАГ ВМЕСТЕ</span>
        <h2>{b.title}</h2>
        <p>{b.text}</p>
        <div>
          <BookingLink className="button">
            Записаться на занятие <Arrow />
          </BookingLink>
          <a href={'https://t.me/' + encodeURIComponent(telegram)} className="button light">
            Написать в Telegram <Arrow />
          </a>
        </div>
        <a href={'tel:' + phone.replace(/[^+\d]/g, '')} className="contact-phone">
          {phone}
        </a>
      </section>
    );
  return null;
}
export default function Home() {
  const data = useRouteLoaderData<typeof rootLoader>('root');
  const ref = useLandingMotion(data?.revision ?? 0);
  if (!data) throw new Response('Контент недоступен', { status: 503 });
  const blocks = data.blocks.filter((b) => b.visible !== false);
  const formats = blocks.reduce((last, b, i) => (b.kind === 'formats' ? i : last), -1);
  let insertion = formats + 1;
  if (formats === -1) {
    insertion = blocks.findIndex((b) => b.kind === 'steps');
    if (insertion === -1) insertion = blocks.findIndex((b) => b.kind === 'contacts');
    if (insertion === -1) insertion = blocks.length;
  }
  const sections = blocks.map((block) => (
    <Scene key={block.id} block={block} phone={data.phone} telegram={data.telegram} />
  ));
  sections.splice(insertion, 0, <ScheduleSection key="public-schedule" />);
  return (
    <main id="main" ref={ref}>
      {sections}
    </main>
  );
}
