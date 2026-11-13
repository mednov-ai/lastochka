import { expect, test, type Page } from '@playwright/test';

const fixture = process.env.POLISH_FIXTURE_URL ?? 'http://127.0.0.1:48794';
const oldIntro =
  'Оздоровительная гимнастика для осанки, сильной спины и радости движения. В маленькой группе, с большим вниманием к каждому.';
const mode = (query: string) => fetch(`${fixture}/__fixture/mode?${query}`);
/** The window is skipped for automated browsers; these tests behave like a visitor. */
const asVisitor = (page: Page) =>
  page.addInitScript(() => Object.defineProperty(navigator, 'webdriver', { get: () => false }));
const header = (page: Page) =>
  page.evaluate(() => {
    const element = document.querySelector('.header')!;
    const parts = [
      ...element.querySelectorAll('.brand, .desktop-navigation a, .phone, .header-actions .button'),
    ].map((item) => item.getBoundingClientRect());
    return {
      height: element.getBoundingClientRect().height,
      logo: element.querySelector('.brand img')!.getBoundingClientRect().width,
      rows: new Set(parts.map((box) => Math.round(box.top + box.height / 2))).size,
      overlap: parts.some((a, i) =>
        parts.some((b, j) => j > i && a.right > b.left + 1 && b.right > a.left + 1),
      ),
      overflow: document.documentElement.scrollWidth > innerWidth,
      heading: document.querySelector('.landing-hero h1')!.getBoundingClientRect().top + scrollY,
    };
  });

test.beforeEach(() => mode('mode=full&intro=replaced'));

test.describe('вводный текст', () => {
  for (const intro of ['replaced', 'original'])
    test(`прежний абзац виден при сохранённом значении: ${intro}`, async ({ page }) => {
      await mode(`intro=${intro}`);
      await page.goto('/');
      await expect(page.locator('.landing-intro')).toHaveText(oldIntro);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(
        'Гимнастика для детей и взрослых',
      );
      await expect(page.locator('.landing-location')).toHaveText(
        'Белгород · Дети от 3 лет · подростки и взрослые',
      );
    });
  test('изменённый текст не подменяется', async ({ page }) => {
    await mode('intro=custom');
    await page.goto('/');
    await expect(page.locator('.landing-intro')).toHaveText('Свой текст студии о занятиях.');
  });
  test('текст есть в серверной разметке', async ({ request }) => {
    expect(await (await request.get('/')).text()).toContain(oldIntro);
  });
});

test.describe('шапка на компьютере', () => {
  for (const width of [1001, 1024, 1280, 1440, 1920])
    test(`одна строка и уменьшение после прокрутки: ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto('/');
      await page.waitForLoadState('networkidle');
      const rest = await header(page);
      expect(rest.height).toBeLessThanOrEqual(104);
      expect(rest.logo).toBeGreaterThanOrEqual(168);
      expect(rest).toMatchObject({ rows: 1, overlap: false, overflow: false });
      await page.evaluate(() => scrollTo(0, 600));
      await expect.poll(async () => (await header(page)).height).toBeLessThanOrEqual(72);
      await page.waitForTimeout(300);
      const compact = await header(page);
      expect(compact.logo).toBeGreaterThanOrEqual(120);
      expect(compact).toMatchObject({ rows: 1, overlap: false, overflow: false });
      // The page below the header must not move when the header changes size.
      expect(Math.abs(compact.heading - rest.heading)).toBeLessThanOrEqual(1);
      await page.evaluate(() => scrollTo(0, 0));
      await expect.poll(async () => (await header(page)).height).toBeGreaterThan(80);
    });

  test('у порога состояние не мерцает', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 800 });
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.evaluate(() => {
      (window as unknown as { toggles: number }).toggles = 0;
      new MutationObserver(() => (window as unknown as { toggles: number }).toggles++).observe(
        document.documentElement,
        { attributes: true, attributeFilter: ['class'] },
      );
    });
    for (const y of [97, 90, 60, 100, 40, 99]) {
      await page.evaluate((top) => scrollTo(0, top), y);
      await page.waitForTimeout(250);
    }
    expect(await page.evaluate(() => (window as unknown as { toggles: number }).toggles)).toBe(1);
    await expect(page.locator('html')).toHaveClass(/header-compact/);
  });

  test('якоря видны под шапкой в обоих состояниях', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 800 });
    for (const anchor of ['schedule', 'contacts']) {
      await page.goto(`/#${anchor}`);
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(400);
      const gap = await page.evaluate(
        (id) =>
          document.getElementById(id)!.querySelector('h2')!.getBoundingClientRect().top -
          document.querySelector('.header')!.getBoundingClientRect().bottom,
        anchor,
      );
      expect(gap).toBeGreaterThanOrEqual(0);
    }
    await page.goto('/');
    await page
      .getByRole('navigation', { name: 'Основная навигация' })
      .getByRole('link', { name: 'Расписание' })
      .click();
    await page.waitForTimeout(500);
    const box = await page.evaluate(() => ({
      top: document.querySelector('#schedule-heading')!.getBoundingClientRect().top,
      bottom: document.querySelector('.header')!.getBoundingClientRect().bottom,
    }));
    expect(box.top).toBeGreaterThanOrEqual(box.bottom);
    expect(box.top).toBeLessThan(700);
  });

  test('без JavaScript и на телефоне пределы сохраняются', async ({ browser, baseURL }) => {
    const context = await browser.newContext({
      javaScriptEnabled: false,
      viewport: { width: 1440, height: 800 },
    });
    const page = await context.newPage();
    await page.goto(baseURL!);
    expect((await page.locator('.header').boundingBox())!.height).toBeLessThanOrEqual(104);
    await page.setViewportSize({ width: 375, height: 800 });
    expect((await page.locator('.header').boundingBox())!.height).toBeLessThanOrEqual(104);
    await context.close();
  });

  test('на телефоне шапка не меняется при прокрутке', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    const before = (await page.locator('.header').boundingBox())!.height;
    await page.evaluate(() => scrollTo(0, 600));
    await page.waitForTimeout(300);
    expect((await page.locator('.header').boundingBox())!.height).toBe(before);
    expect(before).toBeLessThanOrEqual(104);
    await expect(page.locator('html')).not.toHaveClass(/header-compact/);
  });
});

test.describe('окно согласия', () => {
  const dialog = (page: Page) =>
    page.getByRole('dialog', { name: 'Обработка персональных данных' });

  test('первое посещение, согласие и повторные посещения', async ({ page }) => {
    await asVisitor(page);
    await page.goto('/');
    await expect(dialog(page)).toBeVisible();
    await expect(dialog(page).getByRole('button', { name: 'Согласен' })).toBeFocused();
    // The page below is inert: its controls cannot be reached.
    expect(
      await page.evaluate(() => {
        const box = document.querySelector('.landing-inline-link')!.getBoundingClientRect();
        return (
          document
            .elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)
            ?.closest('dialog') !== null ||
          document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)?.closest('a') ===
            null
        );
      }),
    ).toBe(true);
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toBeVisible();
    const box = (await dialog(page).getByRole('button', { name: 'Согласен' }).boundingBox())!;
    expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(44);
    await dialog(page).getByRole('button', { name: 'Согласен' }).click();
    await expect(dialog(page)).toBeHidden();
    await expect(page.getByRole('link', { name: 'Посмотреть расписание' })).toBeVisible();
    await page.goto('/enquiry');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(dialog(page)).toBeHidden();
    await page.reload();
    await expect(dialog(page)).toBeHidden();
  });

  test('политику можно прочитать до согласия', async ({ page }) => {
    await asVisitor(page);
    await page.goto('/enquiry');
    await dialog(page)
      .getByRole('link', { name: 'Политика обработки персональных данных' })
      .click();
    await expect(page).toHaveURL(/legal\/privacy$/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Политика');
    await expect(dialog(page)).toBeHidden();
    await page.goto('/legal/terms');
    await expect(dialog(page)).toBeHidden();
    await page.goto('/');
    await expect(dialog(page)).toBeVisible();
  });

  test('клавиатура удерживается в окне', async ({ page }) => {
    await asVisitor(page);
    await page.goto('/');
    await expect(dialog(page)).toBeVisible();
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('Tab');
      expect(
        await page.evaluate(() => {
          const active = document.activeElement;
          return !active || active === document.body || !!active.closest('dialog');
        }),
      ).toBe(true);
    }
  });

  for (const [width, height] of [
    [320, 568],
    [375, 812],
    [1440, 900],
  ])
    test(`помещается на экране ${width}`, async ({ page }) => {
      await asVisitor(page);
      await page.setViewportSize({ width, height });
      await page.goto('/');
      const box = (await dialog(page).boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      expect(box.y + box.height).toBeLessThanOrEqual(height);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await expect(dialog(page).getByRole('button', { name: 'Согласен' })).toBeInViewport();
    });

  test('увеличенный текст: кнопка достижима прокруткой окна', async ({ page }) => {
    await asVisitor(page);
    await page.setViewportSize({ width: 375, height: 600 });
    await page.goto('/');
    await page.evaluate(() => (document.documentElement.style.fontSize = '200%'));
    const button = dialog(page).getByRole('button', { name: 'Согласен' });
    await button.scrollIntoViewIfNeeded();
    await expect(button).toBeInViewport();
    expect((await dialog(page).boundingBox())!.height).toBeLessThanOrEqual(600);
  });

  test('хранилище недоступно: окно закрывается до перезагрузки', async ({ page }) => {
    await asVisitor(page);
    await page.addInitScript(() => {
      Storage.prototype.setItem = () => {
        throw new Error('denied');
      };
      Storage.prototype.getItem = () => {
        throw new Error('denied');
      };
    });
    await page.goto('/');
    await dialog(page).getByRole('button', { name: 'Согласен' }).click();
    await expect(dialog(page)).toBeHidden();
    await page.getByRole('link', { name: 'Посмотреть расписание' }).click();
    await expect(dialog(page)).toBeHidden();
    await page.reload();
    await expect(dialog(page)).toBeVisible();
  });

  test('английская локаль браузера не меняет текст', async ({ browser, baseURL }) => {
    const context = await browser.newContext({ locale: 'en-US' });
    const page = await context.newPage();
    await asVisitor(page);
    await page.goto(baseURL!);
    await expect(dialog(page)).toContainText('Студия «Ласточка» обрабатывает персональные данные');
    await context.close();
  });

  test('без JavaScript окна нет, документы доступны', async ({ browser, baseURL }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto(baseURL!);
    await expect(page.locator('.privacy-consent')).toHaveCount(0);
    await expect(
      page.getByRole('link', { name: 'Политика обработки персональных данных' }),
    ).toBeVisible();
    await context.close();
  });
});

test.describe('расписание-афиша', () => {
  const table = (page: Page) =>
    page.getByRole('table', { name: /Занятия по дням недели и возрасту/ });
  const open = async (page: Page, width = 1440) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/#schedule');
    await expect(page.locator('.poster-footer')).toBeVisible();
  };
  const nextWeek = (page: Page) => page.getByRole('button', { name: 'Следующая неделя' }).click();

  test('заполненная неделя: дни в столбцах, направления в строках', async ({ page }) => {
    await open(page);
    await nextWeek(page);
    await expect(page.getByRole('heading', { name: 'Расписание занятий' })).toBeVisible();
    await expect(page.getByText('Расписание наполняется, группы ещё формируются')).toBeVisible();
    await expect(page.locator('#schedule')).toContainText('Время московское');
    await expect(table(page).getByRole('columnheader')).toHaveText([
      'Возраст',
      /Понедельник/,
      /Вторник/,
      /Среда/,
      /Четверг/,
      /Пятница/,
      /Суббота/,
    ]);
    await expect(table(page).getByRole('rowheader')).toHaveText([
      '3–5 лет',
      '6–7 лет',
      '8–9 лет',
      '10–13 лет',
      '14+ лет',
      'Другие занятия',
    ]);
    const row = table(page).getByRole('row', { name: /^3–5 лет/ });
    await expect(row.getByRole('cell').nth(0).getByRole('link')).toHaveText('17:00–18:00');
    await expect(row.getByRole('cell').nth(1).getByRole('link')).toHaveCount(0);
    await expect(row.getByRole('cell').nth(2).getByRole('link')).toHaveText('17:00–18:00');
    // Closed session: text without an action.
    const closed = table(page)
      .getByRole('row', { name: /^8–9 лет/ })
      .getByRole('cell')
      .nth(4);
    await expect(closed).toContainText('18:00–19:00');
    await expect(page.locator('#schedule')).not.toContainText('Запись закрыта');
    await expect(closed.getByRole('link')).toHaveCount(0);
    await expect(table(page).getByRole('row', { name: /^Другие занятия/ })).toContainText(
      'Индивидуальное занятие',
    );
    await expect(page.locator('#schedule select')).toHaveCount(0);
    await expect(page.locator('#schedule')).not.toContainText(/человек/);
  });

  test('переход к заявке из ячейки', async ({ page }) => {
    await open(page);
    await nextWeek(page);
    const link = table(page).getByRole('link', {
      name: /Оставить заявку: 3–5 лет, понедельник, .* 17:00–18:00/,
    });
    await expect(link).toHaveAttribute(
      'href',
      /\/enquiry\?session=cccccccc-cccc-4ccc-8ccc-000000000001$/,
    );
    await link.click();
    await expect(page).toHaveURL(/\/enquiry\?session=/);
  });

  test('прошедшее занятие текущей недели показано без действия', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-11-13T09:00:00+03:00') });
    await open(page);
    const row = table(page).getByRole('row', { name: /^3–5 лет/ });
    await expect(row.getByRole('cell').nth(0)).toContainText('17:00–18:00');
    await expect(row.getByRole('cell').nth(0).getByRole('link')).toHaveCount(0);
    await expect(row.getByRole('cell').nth(4).getByRole('link')).toHaveCount(1);
  });

  test('частично заполненная и пустая неделя', async ({ page }) => {
    await mode('mode=partial');
    await open(page);
    await nextWeek(page);
    await expect(table(page).getByRole('row', { name: /^6–7 лет/ })).toContainText(
      'Набираем группу',
    );
    await expect(
      table(page)
        .getByRole('row', { name: /^6–7 лет/ })
        .getByRole('link', { name: 'Оставить заявку' }),
    ).toHaveAttribute('href', /\/enquiry$/);
    await expect(
      table(page)
        .getByRole('row', { name: /^3–5 лет/ })
        .getByRole('link'),
    ).toHaveCount(2);
    await mode('mode=empty');
    await page.reload();
    await expect(table(page).getByRole('rowheader')).toHaveCount(5);
    await expect(table(page).getByText('Набираем группу')).toHaveCount(5);
    await expect(page.getByText('На этой неделе пока нет занятий')).toHaveCount(0);
  });

  test('пустая строка показывает ближайшее занятие, а не набор группы', async ({ page }) => {
    await mode('mode=gap');
    await open(page);
    const younger = table(page).getByRole('row', { name: /^6–7 лет/ });
    await expect(younger).toContainText(/Ближайшее занятие: вторник, \d+ \S+, 17:00/);
    await expect(younger).not.toContainText('Набираем группу');
    await expect(table(page).getByRole('row', { name: /^14\+ лет/ })).toContainText(
      'Набираем группу',
    );
    const range = await page.locator('.poster-range').textContent();
    // The action reads as a link, not as a grey native button.
    const style = await younger
      .getByRole('button', { name: 'Показать следующую неделю' })
      .evaluate((element) => {
        const css = getComputedStyle(element);
        return {
          background: css.backgroundColor,
          border: css.borderTopWidth,
          line: css.textDecorationLine,
        };
      });
    expect(style).toEqual({ background: 'rgba(0, 0, 0, 0)', border: '0px', line: 'underline' });
    await younger.getByRole('button', { name: 'Показать следующую неделю' }).click();
    await expect(page.locator('.poster-range')).not.toHaveText(range!);
    await expect(
      table(page)
        .getByRole('row', { name: /^6–7 лет/ })
        .locator('a.poster-time'),
    ).toHaveCount(2);
  });

  test('без данных о следующей неделе строка не обещает набор группы', async ({ page }) => {
    await mode('mode=gap');
    await page.route('**/api/v1/public/schedule?*', async (route) => {
      const from = new URL(route.request().url()).searchParams.get('from')!;
      // Fail only the look-ahead request for the week after the current one.
      if (
        new Date(from).valueOf() > Date.now() + 86400000 * 0.5 &&
        new Date(from).valueOf() - Date.now() < 8 * 86400000
      )
        return route.fulfill({ status: 503, json: { code: 'SERVICE_UNAVAILABLE' } });
      return route.continue();
    });
    await open(page);
    const younger = table(page).getByRole('row', { name: /^6–7 лет/ });
    await expect(younger).toContainText('На этой неделе занятий нет');
    await expect(younger).not.toContainText('Набираем группу');
    await expect(page.locator('#schedule').getByRole('alert')).toHaveCount(0);
  });

  test('смена недели, дата и больше двадцати занятий', async ({ page }) => {
    await mode('mode=many');
    await open(page);
    const range = page.locator('.poster-range');
    const current = await range.textContent();
    await expect(page.getByRole('button', { name: 'Текущая неделя' })).toBeDisabled();
    await nextWeek(page);
    await expect(range).not.toHaveText(current!);
    await expect(table(page).getByRole('link')).toHaveCount(26);
    await expect(page.getByRole('navigation', { name: 'Расписание' })).toHaveCount(0);
    await page.getByLabel('Дата').fill('2080-01-03');
    await expect(range).toHaveText('1 — 7 января');
    await page.getByRole('button', { name: 'Предыдущая неделя' }).click();
    await expect(range).toHaveText('25 — 31 декабря');
    await page.getByRole('button', { name: 'Текущая неделя' }).click();
    await expect(range).toHaveText(current!);
  });

  test('ошибка расписания и сбой справочника', async ({ page }) => {
    await mode('mode=error');
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/#schedule');
    await expect(page.locator('#schedule').getByRole('alert')).toContainText(
      'Расписание временно недоступно',
    );
    await expect(table(page)).toHaveCount(0);
    await mode('mode=full');
    await page.getByRole('button', { name: 'Повторить загрузку', exact: true }).click();
    await expect(table(page)).toBeVisible();
    await mode('mode=age-error');
    await page.reload();
    await nextWeek(page);
    await expect(
      page.locator('#schedule').getByText('Не удалось загрузить возрастные направления'),
    ).toBeVisible();
    await expect(table(page)).toHaveCount(0);
    await expect(page.locator('.poster-day').first()).toContainText('3–5 лет');
    await expect(page.locator('#schedule').getByText('Другие занятия')).toHaveCount(1);
    await mode('mode=full');
    await page.getByRole('button', { name: 'Повторить загрузку направлений' }).click();
    await expect(table(page)).toBeVisible();
  });

  for (const width of [320, 375, 700])
    test(`карточки по дням на ширине ${width}`, async ({ page }) => {
      await open(page, width);
      await nextWeek(page);
      await expect(table(page)).toBeHidden();
      const monday = page.getByRole('region', { name: /^Понедельник/ });
      await expect(monday).toContainText('3–5 лет');
      await expect(monday.getByRole('link', { name: /Оставить заявку: 3–5 лет/ })).toBeVisible();
      await expect(page.getByText('Расписание наполняется, группы ещё формируются')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      for (const box of await page
        .locator('.poster-week button, .poster-days a.poster-time')
        .evaluateAll((nodes) =>
          nodes
            .map((node) => node.getBoundingClientRect())
            .map((r) => ({ w: r.width, h: r.height })),
        ))
        expect(Math.min(box.w, box.h)).toBeGreaterThanOrEqual(44);
    });

  for (const width of [701, 768, 900, 1024, 1920])
    test(`таблица без прокрутки страницы на ширине ${width}`, async ({ page }) => {
      await open(page, width);
      await nextWeek(page);
      await expect(table(page)).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      // A card that scrolls inside is a keyboard stop; a card that fits is not.
      const card = page.getByRole('region', { name: 'Таблица расписания' });
      await expect
        .poll(() =>
          card.evaluate(
            (element) =>
              element.scrollWidth > element.clientWidth + 1 ===
              (element.getAttribute('tabindex') === '0'),
          ),
        )
        .toBe(true);
    });

  test('увеличенный текст и клавиатура', async ({ page, browserName }) => {
    // Safari reaches links with Option+Tab unless full keyboard access is enabled.
    const tab = browserName === 'webkit' ? 'Alt+Tab' : 'Tab';
    await open(page);
    await nextWeek(page);
    await page.evaluate(() => (document.documentElement.style.fontSize = '200%'));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.getByRole('button', { name: 'Предыдущая неделя' }).focus();
    const seen: string[] = [];
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press(tab);
      const state = await page.evaluate(() => {
        const active = document.activeElement as HTMLElement;
        const box = active.getBoundingClientRect();
        return {
          name: active.getAttribute('aria-label') ?? active.textContent ?? '',
          // An element taller than the space between the panels must at least show its top edge.
          clear: (() => {
            const top = document.querySelector('.header')!.getBoundingClientRect().bottom;
            const bottom = document.querySelector('.site-footer')!.getBoundingClientRect().top;
            return box.top >= top - 1 && (box.bottom <= bottom + 1 || box.height > bottom - top);
          })(),
        };
      });
      seen.push(state.name);
      expect(state.clear, state.name).toBe(true);
    }
    expect(seen.some((name) => name.startsWith('Оставить заявку: 3–5 лет'))).toBe(true);
  });

  test('без JavaScript остаётся переход к заявке', async ({ browser, baseURL }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto(baseURL!);
    await expect(page.locator('#schedule .schedule-static')).toBeVisible();
    await expect(
      page.locator('#schedule .schedule-static').getByRole('link', { name: 'Оставить заявку' }),
    ).toBeVisible();
    await context.close();
  });
});
