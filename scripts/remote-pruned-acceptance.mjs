// Authorized 0.8.0 acceptance: only the closed operator-created disposable ADMIN.
import {
  chromium,
  webkit,
  expect,
} from "../frontend/node_modules/@playwright/test/index.mjs";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
const root = new URL("../", import.meta.url),
  privateDir = new URL("runtime-data/prune-legacy/", root),
  output = new URL("artifacts/prune-legacy/server-acceptance/", root);
mkdirSync(output, { recursive: true, mode: 0o700 });
const fixture = JSON.parse(
  execFileSync(
    "ssh",
    [
      "-o",
      "BatchMode=yes",
      "repairdevice-selectel",
      "python3",
      "-",
      "acceptance",
    ],
    {
      input: readFileSync(new URL("server-ops.py", privateDir)),
      stdio: ["pipe", "pipe", "pipe"],
    },
  ),
);
if (!/^concept-check-[a-f0-9]{10}$/.test(fixture.login))
  throw Error("Own acceptance fixture required");
const base = "https://play-and-say.ru/lastochka",
  checks = process.env.ACCEPTANCE_RESUME
    ? JSON.parse(readFileSync(new URL("checks.json", output))).checks
    : [];
function check(value, label) {
  if (!value) throw Error(label);
  checks.push(label);
  writeFileSync(
    new URL("checks.json", output),
    JSON.stringify({ checks }, null, 2),
    { mode: 0o600 },
  );
}
async function request(c, method, path, body, key = randomUUID()) {
  const csrf = await (await c.request.get(base + "/api/v1/auth/csrf")).json();
  return c.request.fetch(base + "/api/v1" + path, {
    method,
    data: body,
    headers: {
      [csrf.headerName]: csrf.token,
      "Idempotency-Key": key,
      Origin: "https://play-and-say.ru",
    },
  });
}
async function api(c, method, path, body, key) {
  const r = await request(c, method, path, body, key);
  if (!r.ok())
    throw Error(
      method + " " + path + " HTTP " + r.status() + " " + (await r.text()),
    );
  return r.json();
}
const browser = await chromium.launch();
const c = await browser.newContext();
try {
  if (!process.env.ACCEPTANCE_RESUME) {
    for (const path of [
      "/mail_hog_test",
      "/mail_hog_test/",
      "/mail_hog_test/js/controllers.js",
      "/mail_hog_test/api/v2/messages",
      "/mail_hog_test/api/v2/websocket",
    ])
      check(
        (await c.request.get(base + path)).status() === 404,
        "public mail closed " + path,
      );
    for (const path of [
      "/bookings",
      "/children",
      "/auth/register",
      "/auth/verify-email",
      "/auth/reset-password",
    ])
      check(
        (
          await request(
            c,
            path.includes("/auth/") ? "POST" : "GET",
            path,
            path.includes("/auth/") ? {} : undefined,
          )
        ).status() === 410,
        "legacy closed " + path,
      );
    for (const path of [
      "/admin/enquiries",
      "/admin/payment-requests",
      "/admin/calendar?from=2027-02-01T00:00:00Z&to=2027-02-08T00:00:00Z",
    ])
      check(
        !(await c.request.get(base + "/api/v1" + path)).ok(),
        "guest cannot read " + path,
      );
    const auth = await api(c, "POST", "/auth/password-stage", {
      login: fixture.login,
      password: fixture.password,
    });
    check(
      auth.state === "FULL" && !JSON.stringify(auth).includes("email"),
      "login without email",
    );
    const sessionInput = {
      title: fixture.login,
      format: "GROUP",
      startsAt: "2027-02-03T10:00:00Z",
      endsAt: "2027-02-03T11:00:00Z",
      capacity: 8,
    };
    let session = await api(c, "POST", "/admin/sessions", sessionInput);
    check(session.status === "DRAFT", "schedule draft");
    session = await api(c, "POST", `/admin/sessions/${session.id}/actions`, {
      expectedVersion: session.version,
      action: "PUBLISH",
    });
    check(
      session.status === "OPEN" && !("freePlaces" in session),
      "published without occupancy",
    );
    const calendar = await (
      await c.request.get(
        base +
          "/api/v1/admin/calendar?from=2027-02-01T00:00:00Z&to=2027-02-08T00:00:00Z",
      )
    ).json();
    check(
      calendar.items.some((x) => x.id === session.id),
      "calendar publication",
    );
    const guest = await browser.newContext();
    check(
      (
        await guest.request.post(base + "/api/v1/enquiries", {
          data: {},
          headers: { Origin: "https://foreign.invalid" },
        })
      ).status() === 403,
      "cross-origin enquiry rejected",
    );
    const input = {
      parentName: fixture.login,
      phone: "+79001234567",
      childName: "Синтетическая проверка",
      childAge: 7,
      desiredSessionId: session.id,
      desiredSessionVersion: session.version,
      comment: "Серверная проверка, удалить после приёмки",
    };
    const key = randomUUID();
    const first = await api(guest, "POST", "/enquiries", input, key),
      same = await api(guest, "POST", "/enquiries", input, key);
    check(
      JSON.stringify(first) === JSON.stringify(same),
      "enquiry replay has one receipt",
    );
    check(
      Object.keys(first).sort().join(",") === "createdAt,number",
      "receipt contains no contacts",
    );
    const enquiries = await (
      await c.request.get(base + "/api/v1/admin/enquiries")
    ).json();
    const enquiry = enquiries.items.find((x) => x.number === first.number);
    check(
      !!enquiry && enquiry.parentName === fixture.login,
      "administrator reads saved enquiry",
    );
    const delivery = await (
      await c.request.get(
        base + `/api/v1/admin/enquiries/${enquiry.id}/delivery`,
      )
    ).json();
    check(
      delivery.configured === false && delivery.attempts === 0,
      "delivery waits for bot configuration",
    );
    const draft = await api(c, "POST", "/admin/payment-requests", {
      amountMinor: 12345,
      purpose: fixture.login,
      recipientName: fixture.login,
      phone: "+79001234567",
      enquiryId: enquiry.id,
    });
    check(draft.amountMinor === 12345, "draft keeps exact kopecks");
    const issue = await request(
      c,
      "POST",
      `/admin/payment-requests/${draft.id}/issue`,
      {},
    );
    check(
      issue.status() === 409 &&
        (await issue.json()).code === "PAYMENT_PROVIDER_NOT_CONFIGURED",
      "real payment issue disabled",
    );
    check(
      (
        await c.request.post(base + "/api/v1/admin/sessions", {
          data: sessionInput,
        })
      ).status() === 403,
      "administrative command requires CSRF",
    );
    await guest.close();
  }
  for (const [name, engine] of [
    ["chromium", chromium],
    ["webkit", webkit],
  ]) {
    const b = await engine.launch();
    try {
      for (const locale of ["en-US", "ru-RU"])
        for (const width of [375, 1440]) {
          if (
            process.env.ACCEPTANCE_RESUME &&
            (name !== "webkit" || locale !== "ru-RU")
          )
            continue;
          const context = await b.newContext({
              locale,
              viewport: { width, height: 900 },
            }),
            page = await context.newPage(),
            errors = [];
          page.on("pageerror", (e) => {
            errors.push(e.message);
            writeFileSync(
              new URL(
                "page-errors-" + name + "-" + locale + "-" + width + ".json",
                output,
              ),
              JSON.stringify(errors),
            );
          });
          await page.goto(base + "/");
          await page
            .locator(".format-card")
            .first()
            .getByRole("link", { name: "Выбрать занятие" })
            .click();
          await expect(
            page.getByRole("heading", { name: "Заявка на занятие" }),
          ).toBeVisible();
          await page.getByRole("button", { name: "Отправить заявку" }).click();
          await expect(
            page
              .locator(".field-error")
              .filter({ hasText: "Заполните" })
              .first(),
          ).toBeVisible();
          if (
            locale === "ru-RU" &&
            (!process.env.ACCEPTANCE_RESUME || width === 1440)
          ) {
            await page.getByLabel("Имя родителя").fill(fixture.login);
            await page
              .getByLabel("Телефон", { exact: true })
              .fill("89001234567");
            await page.getByLabel("Имя ребёнка").fill("Синтетическая проверка");
            await page.getByLabel("Возраст ребёнка").fill("7");
            await page
              .getByRole("button", { name: "Отправить заявку" })
              .click();
            await expect(
              page.getByRole("heading", { name: "Заявка принята" }),
            ).toBeVisible();
          }
          await page.waitForLoadState("networkidle");
          await page.goto(base + "/auth/login");
          check(
            (await page
              .getByRole("textbox", { name: "Электронная почта" })
              .count()) === 0,
            "no email field " + name + locale + width,
          );
          await page.getByLabel("Логин", { exact: true }).fill(fixture.login);
          await page
            .getByLabel("Пароль", { exact: true })
            .fill(fixture.password);
          await page
            .getByRole("button", { name: "Войти", exact: true })
            .click();
          await expect(
            page.getByRole("heading", { name: "Расписание", exact: true }),
          ).toBeVisible();
          await page.getByRole("link", { name: "Заявки", exact: true }).click();
          await expect(
            page.getByRole("button", { name: "Открыть заявку" }).first(),
          ).toBeVisible();
          await page
            .getByRole("button", { name: "Открыть заявку" })
            .first()
            .click();
          await expect(page.getByRole("dialog")).toContainText(
            "Ожидает настройки бота",
          );
          await page.keyboard.press("Escape");
          await page.getByRole("link", { name: "Оплата", exact: true }).click();
          await expect(
            page.getByRole("heading", { name: fixture.login, exact: true }),
          ).toBeVisible();
          const cookie = (await context.cookies()).find(
            (x) => x.name === "LASTOCHKA_SESSION",
          );
          check(
            cookie?.secure && cookie.httpOnly && cookie.path === "/lastochka",
            "scoped secure cookie " + name + locale + width,
          );
          check(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth + 1,
            ),
            "mobile width " + name + locale + width,
          );
          check(errors.length === 0, "no page errors " + name + locale + width);
          await page.screenshot({
            path: new URL(name + "-" + locale + "-" + width + ".png", output)
              .pathname,
            fullPage: true,
          });
          await context.close();
        }
    } finally {
      await b.close();
    }
  }
  const nojs = await browser.newContext({
    javaScriptEnabled: false,
    locale: "en-US",
    viewport: { width: 375, height: 900 },
  });
  const p = await nojs.newPage();
  await p.goto(base + "/enquiry");
  await p.getByLabel("Имя родителя").fill(fixture.login);
  await p.getByLabel("Телефон", { exact: true }).fill("+79001234567");
  await p.getByLabel("Имя ребёнка").fill("Синтетическая проверка");
  await p.getByLabel("Возраст ребёнка").fill("8");
  await p.getByRole("button", { name: "Отправить заявку" }).click();
  await expect(
    p.getByRole("heading", { name: "Заявка принята" }),
  ).toBeVisible();
  check(true, "public HTTPS form without JavaScript");
  await nojs.close();
  if (process.env.ACCEPTANCE_RESUME)
    await api(c, "POST", "/auth/password-stage", {
      login: fixture.login,
      password: fixture.password,
    });
  check(
    (await (await c.request.get(base + "/api/v1/auth/me")).json()).state ===
      "FULL",
    "session remains valid through acceptance",
  );
  console.log(
    JSON.stringify({ passed: checks.length, fixtureLogin: fixture.login }),
  );
} finally {
  await browser.close();
}
