// Read-only business-data acceptance for the frontend 0.4.1 image-composition release.
// Start before rollout; signal frontend-0.4.1-ready only after readiness passes.
import { chromium } from "../frontend/node_modules/playwright/index.mjs";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
const base = "https://play-and-say.ru/lastochka";
const output = new URL("../artifacts/server-deploy/0.4.1/", import.meta.url);
const ready = new URL(
  "../runtime-data/server-deploy/old-tab-0.4.1-ready",
  import.meta.url,
);
const marker = new URL(
  "../runtime-data/server-deploy/frontend-0.4.1-ready",
  import.meta.url,
);
mkdirSync(output, { recursive: true });
const report = { url: base, checks: [], routeData: [] };
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
try {
  if (process.env.ACCEPTANCE_AFTER_ROLLOUT === '1') {
    const previous=JSON.parse(readFileSync(new URL('browser-first-run.json',output),'utf8'));
    check(previous.checks.includes('Old tab schedule.data succeeds after rollout'), 'Old-tab navigation proof retained from the rollout run');
    report.oldAssets=previous.oldAssets;
    report.oldTabEvidence='browser-first-run.json';
  } else {
  const old = await browser.newPage();
  await old.goto(base + "/");
  await old.getByRole("link", { name: "Войти", exact: true }).click();
  await old
    .getByRole("dialog")
    .getByRole("heading", { name: "Рады вас видеть" })
    .waitFor();
  await old.keyboard.press("Escape");
  report.oldAssets = await old.evaluate(() =>
    performance
      .getEntriesByType("resource")
      .map((e) => e.name)
      .filter((u) => u.includes("/lastochka/assets/")),
  );
  check(
    report.oldAssets.length > 4,
    "Old tab and its chunks loaded before rollout",
  );
  save();
  writeFileSync(ready, "ready");
  const deadline = Date.now() + 15 * 60000;
  while (!existsSync(marker)) {
    if (Date.now() > deadline) throw Error("Rollout marker timeout");
    await new Promise((done) => setTimeout(done, 1000));
  }
  for (const url of report.oldAssets) {
    const r = await old.request.get(url);
    check(
      r.ok() && !r.headers()["content-type"].includes("text/html"),
      "Old hashed asset still available",
    );
  }
  const response = old.waitForResponse(
    (r) => new URL(r.url()).pathname === "/lastochka/schedule.data",
  );
  await old
    .getByRole("link", { name: "Посмотреть расписание", exact: true })
    .click();
  check(
    (await response).status() === 200,
    "Old tab schedule.data succeeds after rollout",
  );
  await old.getByRole("heading", { name: "Время для движения." }).waitFor();
  await old.close();
  }
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const p = await context.newPage();
  p.on("response", (r) => {
    const path = new URL(r.url()).pathname;
    if (path.endsWith(".data"))
      report.routeData.push({ path, status: r.status() });
  });
  check(
    (await p.request.get(base + "/")).status() === 200,
    "Anonymous landing is public",
  );
  check(
    [401, 403].includes(
      (await p.request.get(base + "/api/v1/children")).status(),
    ),
    "Guest private API is closed",
  );
  await p.goto(base + "/#formats");
  const img = p.locator(".format-card img").first();
  await img.scrollIntoViewIfNeeded();
  await img.evaluate((el) => el.decode());
  check(
    (await img.getAttribute("src")).endsWith("/images/mini-group-v2.webp"),
    "New image URL is rendered",
  );
  const r = await p.request.get(base + "/images/mini-group-v2.webp");
  const expected = readFileSync(
    new URL("../frontend/public/images/mini-group-v2.webp", import.meta.url),
  );
  check(
    r.ok() &&
      createHash("sha256")
        .update(await r.body())
        .digest("hex") === createHash("sha256").update(expected).digest("hex"),
    "Public WebP matches verified local bytes",
  );
  await p
    .locator(".format-card")
    .first()
    .screenshot({ path: new URL("mini-group-mobile.png", output).pathname });
  const targets = [
    p.getByRole("link", { name: "Хочу на первое занятие", exact: true }),
    ...(await p
      .getByRole("link", { name: "Выбрать занятие", exact: true })
      .all()),
    p.getByRole("link", { name: "Записаться на занятие", exact: true }),
    p.getByRole("link", { name: "Записаться", exact: true }),
  ];
  check(targets.length === 6, "All six booking CTAs are present");
  for (const target of targets) {
    await target.click();
    await p
      .getByRole("dialog")
      .getByRole("heading", { name: "Начнём знакомство" })
      .waitFor();
    await p.keyboard.press("Escape");
    check(true, "Guest booking CTA opens registration");
  }
  await p
    .getByRole("link", { name: "Посмотреть расписание", exact: true })
    .click();
  await p.getByRole("heading", { name: "Время для движения." }).waitFor();
  check(true, "Public schedule Link works");
  await p.goto(base + "/");
  await p.getByRole("link", { name: "Войти", exact: true }).click();
  const dialog = p.getByRole("dialog");
  const password = readFileSync(
    new URL("../info/password.txt", import.meta.url),
    "utf8",
  ).trim();
  await dialog
    .getByLabel("Email", { exact: true })
    .fill("client4@lastochka.test");
  await dialog.getByLabel("Пароль", { exact: true }).fill(password);
  await dialog.getByRole("button", { name: "Войти", exact: true }).click();
  await p.waitForURL(new RegExp("^" + base.replaceAll(".", "\\.") + "/(?:account/bookings|schedule)$"));
  const me = await (await p.request.get(base + "/api/v1/auth/me")).json();
  check(
    me.state === "FULL",
    "Existing test parent password login works without WebAuthn",
  );
  check(
    (await p.request.get(base + "/api/v1/admin/families")).status() === 403,
    "Parent cannot access administrator data",
  );
  await p.getByRole("link", { name: "Ласточка — на главную" }).click();
  await p
    .getByRole("link", { name: "Записаться на занятие", exact: true })
    .click();
  await p.waitForURL(base + "/schedule");
  check(
    (await p.getByRole("dialog").count()) === 0,
    "Full-session CTA opens schedule directly",
  );
  await p.getByRole("link", { name: "Мой кабинет", exact: true }).click();
  await p.getByRole("heading", { name: "Мои записи", exact: true }).waitFor();
  await p.reload();
  await p.getByRole("heading", { name: "Мои записи", exact: true }).waitFor();
  check(true, "Authenticated Link navigation and reload work");
  const cookies = await context.cookies();
  check(
    cookies.some(
      (c) =>
        c.name === "LASTOCHKA_SESSION" &&
        c.secure &&
        c.httpOnly &&
        c.path === "/lastochka",
    ),
    "Session cookie isolation remains",
  );
  const csrf = await (await p.request.get(base + "/api/v1/auth/csrf")).json();
  const logout = await p.request.post(base + "/api/v1/auth/logout", {
    headers: { [csrf.headerName]: csrf.token },
  });
  check(logout.ok(), "Own acceptance session logged out");
  check(
    report.routeData.length > 0 &&
      report.routeData.every((x) => x.status === 200),
    "Observed route data requests succeeded",
  );
  report.passed = true;
  save();
  console.log(
    "Public format release acceptance passed: " +
      report.checks.length +
      " checks",
  );
} catch (error) {
  report.passed = false;
  const secret=readFileSync(new URL('../info/password.txt',import.meta.url),'utf8').trim();
  report.error = String(error).replaceAll(secret, '[redacted]');
  save();
  throw new Error(report.error);
} finally {
  await browser.close();
}
