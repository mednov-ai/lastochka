// Operator acceptance for the frontend-only Lastochka test-preview release.
// Start before rollout; create runtime-data/server-deploy/frontend-0.4.0-ready after health passes.
import { chromium } from "../frontend/node_modules/playwright/index.mjs";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
const base = "https://play-and-say.ru/lastochka";
const output = new URL("../artifacts/server-deploy/0.4.0/", import.meta.url);
const marker = new URL(
  "../runtime-data/server-deploy/frontend-0.4.0-ready",
  import.meta.url,
);
const ready = new URL(
  "../runtime-data/server-deploy/old-tab-0.4.0-ready",
  import.meta.url,
);
mkdirSync(output, { recursive: true });
const report = {
  url: base,
  parentEmail:
    "landing-acceptance-" + randomUUID().slice(0, 12) + "@lastochka.test",
  checks: [],
  routeData: [],
};
const save = () =>
  writeFileSync(
    new URL("browser.json", output),
    JSON.stringify(report, null, 2),
  );
function check(value, name) {
  if (!value) throw Error(name);
  report.checks.push(name);
}
const browser = await chromium.launch();
async function call(page, method, path, body) {
  const c = await (await page.request.get(base + "/api/v1/auth/csrf")).json();
  return page.request.fetch(base + "/api/v1" + path, {
    method,
    data: body,
    headers: { [c.headerName]: c.token },
  });
}
try {
  const old = await browser.newPage();
  await old.goto(base + "/");
  await old.getByRole("link", { name: "Войти", exact: true }).click();
  await old.getByRole("dialog").waitFor();
  await old.keyboard.press("Escape");
  const oldAssets = await old.evaluate(() =>
    performance.getEntriesByType("resource").map((e) => e.name),
  );
  report.oldAssets = oldAssets.filter((x) => x.includes("/lastochka/assets/"));
  check(report.oldAssets.length > 0, "Old tab loaded before rollout");
  save();
  writeFileSync(ready, "ready");
  const deadline = Date.now() + 15 * 60000;
  while (!existsSync(marker)) {
    if (Date.now() > deadline) throw Error("Rollout marker timeout");
    await new Promise((r) => setTimeout(r, 1000));
  }
  for (const url of report.oldAssets) {
    const r = await old.request.get(url);
    check(
      r.ok() && !r.headers()["content-type"].includes("text/html"),
      "Old hashed asset remains available",
    );
  }
  const navigation = old.waitForResponse(
    (r) => new URL(r.url()).pathname === "/lastochka/schedule.data",
  );
  await old
    .getByRole("link", { name: "Посмотреть расписание", exact: true })
    .click();
  check(
    (await navigation).status() === 200,
    "Tab opened before rollout navigates with schedule.data 200",
  );
  await old.getByRole("heading", { name: "Время для движения." }).waitFor();
  await old.goBack();
  await old.reload();
  await old.close();
  const guest = await browser.newContext();
  const p = await guest.newPage();
  p.on("response", (r) => {
    const u = new URL(r.url());
    if (u.pathname.endsWith(".data"))
      report.routeData.push({ path: u.pathname, status: r.status() });
  });
  check(
    (await p.request.get(base + "/")).status() === 200,
    "Landing public without Basic Auth",
  );
  check(
    [401, 403].includes(
      (await p.request.get(base + "/api/v1/children")).status(),
    ),
    "Private API rejects guest",
  );
  for (const width of [375, 1440]) {
    await p.setViewportSize({ width, height: 900 });
    await p.goto(base + "/#contacts");
    const targets = [
      p.getByRole("link", { name: "Хочу на первое занятие", exact: true }),
      ...(await p
        .getByRole("link", { name: "Выбрать занятие", exact: true })
        .all()),
      p.getByRole("link", { name: "Записаться на занятие", exact: true }),
      p.getByRole("link", { name: "Записаться", exact: true }),
    ];
    check(targets.length === 6, "Six booking CTAs at " + width);
    for (const target of targets) {
      await target.click();
      await p
        .getByRole("dialog")
        .getByRole("heading", { name: "Начнём знакомство" })
        .waitFor();
      check(
        p.url() === base + "/#contacts",
        "Register modal preserves location",
      );
      await p.keyboard.press("Escape");
    }
    const img = p.locator("#coach img");
    await img.scrollIntoViewIfNeeded();
    await img.hover();
    const composition = await img.evaluate((el) => ({
      ratio:
        el.getBoundingClientRect().width / el.getBoundingClientRect().height,
      source: el.naturalWidth / el.naturalHeight,
      fit: getComputedStyle(el).objectFit,
      transform: getComputedStyle(el).transform,
    }));
    check(
      Math.abs(composition.ratio - composition.source) < 0.001 &&
        composition.fit === "contain" &&
        composition.transform === "none",
      "Coach composition and hover safe at " + width,
    );
    await p.screenshot({
      path: new URL("coach-" + width + ".png", output).pathname,
    });
    await p.getByRole("link", { name: "Расписание", exact: true }).click();
    await p.getByRole("heading", { name: "Время для движения." }).waitFor();
    check(true, "Guest schedule Link works at " + width);
  }
  await p.goto(base + "/#formats");
  const card = p.locator(".format-card").first();
  await card.hover();
  await p.waitForTimeout(260);
  check(
    await card
      .locator("img")
      .evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).a > 1.02),
    "Public image responds to hover",
  );
  await p.screenshot({ path: new URL("formats-hover.png", output).pathname });
  await p.emulateMedia({ reducedMotion: "reduce" });
  await p.waitForFunction(
    () => document.querySelector("main").dataset.enhanced === "false",
  );
  check(true, "Public reduced-motion switches dynamically");
  await p.emulateMedia({ reducedMotion: "no-preference" });
  await p.goto(base + "/#contacts");
  await p
    .getByRole("link", { name: "Записаться на занятие", exact: true })
    .click();
  const dialog = p.getByRole("dialog");
  await dialog.getByRole("heading", { name: "Начнём знакомство" }).waitFor();
  await p.screenshot({
    path: new URL("registration-modal.png", output).pathname,
  });
  const password = readFileSync(
    new URL("../info/password.txt", import.meta.url),
    "utf8",
  ).trim();
  await dialog.getByLabel("Ваше имя").fill("Временная проверка лендинга");
  await dialog.getByLabel("Email", { exact: true }).fill(report.parentEmail);
  await dialog.getByLabel("Пароль", { exact: true }).fill(password);
  await dialog.getByRole("button", { name: "Создать аккаунт" }).click();
  await dialog.getByRole("status").waitFor();
  let token;
  const until = Date.now() + 30000;
  while (!token && Date.now() < until) {
    const data = await (
      await p.request.get(
        "http://127.0.0.1:18027/api/v2/search?kind=to&query=" +
          encodeURIComponent(report.parentEmail),
      )
    ).json();
    for (const mail of data.items ?? []) {
      const raw = mail.Content.Body;
      const encoding = mail.Content.Headers["Content-Transfer-Encoding"]?.[0];
      const body =
        encoding === "base64"
          ? Buffer.from(raw, "base64").toString("utf8")
          : raw
              .replace(/=\r?\n/g, "")
              .replace(/=([a-f0-9]{2})/gi, (_, hex) =>
                String.fromCharCode(parseInt(hex, 16)),
              );
      const match = body.match(/#token=([a-zA-Z0-9_-]+)/);
      if (match) token = match[1];
    }
    if (!token) await p.waitForTimeout(500);
  }
  check(Boolean(token), "Registration email captured by private MailHog SMTP");
  const emailTab = await guest.newPage();
  await emailTab.goto(base + "/auth/verify#token=" + token);
  await emailTab.getByRole("button", { name: "Подтвердить email" }).click();
  await emailTab
    .getByRole("status")
    .filter({ hasText: "Email подтверждён" })
    .waitFor();
  await emailTab
    .getByRole("main")
    .getByRole("link", { name: "Войти", exact: true })
    .click();
  await emailTab.getByLabel("Email", { exact: true }).fill(report.parentEmail);
  await emailTab.getByLabel("Пароль", { exact: true }).fill(password);
  await emailTab.getByRole("button", { name: "Войти", exact: true }).click();
  await emailTab.waitForURL(base + "/schedule");
  const me = await (
    await emailTab.request.get(base + "/api/v1/auth/me")
  ).json();
  report.parentId = me.account.id;
  check(
    me.state === "FULL",
    "Verified password-only login returns to schedule",
  );
  check(
    (
      await (
        await emailTab.request.get(base + "/api/v1/auth/webauthn/credentials")
      ).json()
    ).length === 0,
    "Passkey remains optional",
  );
  check(
    (await (await emailTab.request.get(base + "/api/v1/bookings")).json()).items
      .length === 0,
    "Registration does not create a booking automatically",
  );
  check(
    (await emailTab.request.get(base + "/api/v1/admin/families")).status() ===
      403,
    "Parent cannot access administrator API",
  );
  const cookie = (await guest.cookies()).find(
    (c) => c.name === "LASTOCHKA_SESSION",
  );
  check(
    cookie?.secure && cookie.httpOnly && cookie.path === "/lastochka",
    "Session cookie keeps secure isolation",
  );
  await emailTab
    .getByRole("link", { name: "Мой кабинет", exact: true })
    .click();
  await emailTab
    .getByRole("heading", { name: "Мои записи", exact: true })
    .waitFor();
  await emailTab.getByRole("link", { name: "Мои дети", exact: true }).click();
  await emailTab
    .getByRole("heading", { name: "Мои дети", exact: true })
    .waitFor();
  await emailTab.goBack();
  await emailTab.goForward();
  await emailTab.reload();
  check(true, "Authenticated cabinet Links, history and reload work");
  await emailTab.getByRole("link", { name: "Ласточка — на главную" }).click();
  await emailTab
    .getByRole("link", { name: "Записаться на занятие", exact: true })
    .click();
  await emailTab.waitForURL(base + "/schedule");
  check(
    (await emailTab.getByRole("dialog").count()) === 0,
    "Full account booking CTA goes directly to schedule",
  );
  for (const path of ["/assets/not-found.js", "/missing-route.data"])
    check(
      (await p.request.get(base + path)).status() === 404,
      "Real 404 preserved for " + path,
    );
  check(
    report.routeData.length > 0 &&
      report.routeData.every((r) => r.status === 200),
    "Actual client route-data requests succeeded",
  );
  await call(emailTab, "POST", "/auth/logout");
  report.passed = true;
  save();
  console.log(
    "Public landing acceptance passed: " + report.checks.length + " checks",
  );
} catch (error) {
  report.passed = false;
  report.error = String(error);
  save();
  throw error;
} finally {
  await browser.close();
}
