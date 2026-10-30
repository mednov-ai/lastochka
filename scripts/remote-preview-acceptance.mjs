// Explicit operator smoke test for this project's deployed public test preview.
// Real native WebAuthn, with disposable virtual keys; never touches the seven user keys.
import { chromium } from "../frontend/node_modules/playwright/index.mjs";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
const base = "https://play-and-say.ru/lastochka";
const shared = readFileSync(
  new URL("../info/password.txt", import.meta.url),
  "utf8",
).trim();
const fixture = JSON.parse(
  readFileSync(
    new URL("../runtime-data/server-deploy/acceptance.json", import.meta.url),
    "utf8",
  ),
);
const parentEmail =
  "acceptance-parent-" + randomUUID().slice(0, 8) + "@lastochka.test";
const report = {
  url: base,
  parentEmail,
  adminEmail: fixture.adminEmail,
  sessions: [],
  children: [],
  bookings: [],
  checks: [],
};
mkdirSync(new URL("../artifacts/server-deploy/0.3.0/", import.meta.url), {
  recursive: true,
});
const reportPath = new URL(
  "../artifacts/server-deploy/0.3.0/browser.json",
  import.meta.url,
);
const browser = await chromium.launch();
const contexts = [];
function check(value, message) {
  if (!value) throw new Error(message);
  report.checks.push(message);
}
async function context(withAuthenticator = true) {
  const ctx = await browser.newContext();
  contexts.push(ctx);
  const page = await ctx.newPage();
  if (!withAuthenticator) return page;
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  return page;
}
async function call(p, method, path, body, key) {
  const csrfResponse = await p.request.get(base + "/api/v1/auth/csrf");
  check(csrfResponse.ok(), "CSRF endpoint is available");
  const csrf = await csrfResponse.json();
  const response = await p.request.fetch(base + "/api/v1" + path, {
    method,
    data: body,
    headers: {
      [csrf.headerName]: csrf.token,
      ...(key ? { "Idempotency-Key": key } : {}),
    },
  });
  return response;
}
async function success(p, method, path, body, key) {
  const r = await call(p, method, path, body, key);
  if (!r.ok())
    throw new Error("Request failed: " + path + " status " + r.status());
  return r.json();
}
async function enter(p, email, password) {
  await p.goto(base + "/");
  await p.getByRole("link", { name: "Войти", exact: true }).click();
  const dialog = p.getByRole("dialog");
  await dialog.getByLabel("Email", { exact: true }).fill(email);
  await dialog.getByLabel("Пароль", { exact: true }).fill(password);
  await dialog.getByRole("button", { name: "Войти", exact: true }).click();
  await p.waitForURL("**/account/bookings");
  await dialog.waitFor({state: "hidden"});
  check(true, "Successful modal login closes dialog");
  const me = await (await p.request.get(base + "/api/v1/auth/me")).json();
  check(me.state === "FULL", "Password alone grants full session");
  check(
    (await p.request.get(base + "/api/v1/children")).status() === 200,
    "Private data is available after verified password login",
  );
  return me;
}

try {
  const guest = await context(false);
  check(
    (await guest.request.get(base + "/")).status() === 200,
    "Anonymous landing needs no Authorization or Basic Auth",
  );
  check(
    [401, 403].includes(
      (await guest.request.get(base + "/api/v1/children")).status(),
    ),
    "Anonymous private API remains closed",
  );
  for (const width of [375, 1440]) {
    await guest.setViewportSize({ width, height: 900 });
    await guest.goto(base + "/");
    const login = guest.getByRole("link", { name: "Войти", exact: true });
    await login.click();
    const dialog = guest.getByRole("dialog");
    await dialog.getByRole("heading", { name: "Рады вас видеть" }).waitFor();
    await dialog
      .getByRole("link", { name: "Создать аккаунт родителя" })
      .click();
    await dialog.getByRole("heading", { name: "Начнём знакомство" }).waitFor();
    for (let i = 0; i < 10; i++) {
      await guest.keyboard.press("Tab");
      check(
        await dialog.evaluate((el) => el.contains(document.activeElement)),
        "Dialog focus remains trapped at " + width,
      );
    }
    check(
      await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth),
      "Dialog fits " + width,
    );
    await guest.screenshot({
      path: new URL(
        "../artifacts/server-deploy/0.3.0/modal-" + width + ".png",
        import.meta.url,
      ).pathname,
    });
    await guest.keyboard.press("Escape");
    check(!(await dialog.isVisible()), "Escape closes dialog at " + width);
    check(
      await login.evaluate((el) => el === document.activeElement),
      "Focus returns to login trigger at " + width,
    );
  }
  const admin = await context();
  report.admin = (
    await enter(admin, fixture.adminEmail, fixture.adminPassword)
  ).account;
  await admin.goto(base + "/account/security");
  await admin
    .getByLabel("Название ключа", { exact: true })
    .fill("Временный ключ приёмки");
  await admin.getByRole("button", { name: "Добавить passkey" }).click();
  await admin.getByRole("button", { name: "Проверить WebAuthn" }).click();
  await admin
    .getByRole("status")
    .filter({ hasText: "Ключ доступа подтверждён" })
    .waitFor();
  check(
    true,
    "Voluntary native WebAuthn enrolls and verifies after password login",
  );
  await admin.evaluate(() =>
    Object.defineProperty(navigator.credentials, "get", {
      value: async () => {
        throw new DOMException("Cancelled", "NotAllowedError");
      },
      configurable: true,
    }),
  );
  await admin.getByRole("button", { name: "Проверить WebAuthn" }).click();
  await admin.getByRole("alert").filter({ hasText: "отменено" }).waitFor();
  check(
    (await admin.request.get(base + "/api/v1/children")).status() === 200,
    "Cancelled optional WebAuthn preserves password access",
  );
  const parent = await context(false);
  await success(parent, "POST", "/auth/register", {
    name: "Временный родитель приёмки",
    email: parentEmail,
    password: fixture.adminPassword,
  });
  let token;
  for (let attempt = 0; attempt < 40 && !token; attempt++) {
    const inbox = await (
      await parent.request.get(
        "http://127.0.0.1:18027/api/v2/messages?limit=100",
      )
    ).json();
    for (const item of inbox.items ?? []) {
      if (!item.Content.Headers.To.join("").includes(parentEmail)) continue;
      const raw = item.Content.Body;
      const encoding = item.Content.Headers["Content-Transfer-Encoding"]?.[0];
      const body =
        encoding === "base64"
          ? Buffer.from(raw, "base64").toString()
          : raw
              .replace(/=\r?\n/g, "")
              .replace(/=([0-9a-f]{2})/gi, (_, hex) =>
                String.fromCharCode(parseInt(hex, 16)),
              );
      token = body.match(/\/auth\/verify#token=([a-zA-Z0-9_-]+)/)?.[1];
      check(
        body.includes(base + "/auth/verify#token="),
        "MailHog verification link uses the public HTTPS prefix",
      );
    }
    if (!token) await new Promise((done) => setTimeout(done, 500));
  }
  check(Boolean(token), "Verification mail captured on the server");
  await success(parent, "POST", "/auth/verify-email", { token });
  report.parent = (
    await enter(parent, parentEmail, fixture.adminPassword)
  ).account;
  for (const name of ["Первый ребёнок приёмки", "Второй ребёнок приёмки"])
    report.children.push(
      await success(parent, "POST", "/children", {
        name,
        birthDate: "2018-05-01",
      }),
    );
  for (const offset of [1, 2]) {
    const start = new Date(Date.now() + offset * 86400000);
    start.setUTCHours(10, 0, 0, 0);
    let slot = await success(
      admin,
      "POST",
      "/admin/sessions",
      {
        title: "Временная проверка поставки " + offset,
        format: "INDIVIDUAL",
        startsAt: start.toISOString(),
        endsAt: new Date(start.valueOf() + 3600000).toISOString(),
        capacity: 1,
      },
      randomUUID(),
    );
    report.sessions.push(slot.id);
    slot = await success(
      admin,
      "POST",
      "/admin/sessions/" + slot.id + "/actions",
      { expectedVersion: slot.version, action: "PUBLISH" },
      randomUUID(),
    );
  }
  let booking = await success(
    parent,
    "POST",
    "/bookings",
    { childId: report.children[0].id, sessionId: report.sessions[0] },
    randomUUID(),
  );
  report.bookings.push(booking.id);
  check(
    booking.status === "PENDING",
    "Booking requires administrator approval",
  );
  check(
    (
      await call(
        parent,
        "POST",
        "/bookings",
        { childId: report.children[1].id, sessionId: report.sessions[0] },
        randomUUID(),
      )
    ).status() === 409,
    "Last occupied seat is rejected",
  );
  booking = await success(
    admin,
    "POST",
    "/admin/bookings/" + booking.id + "/actions",
    { expectedVersion: booking.version, action: "APPROVE" },
    randomUUID(),
  );
  check(booking.status === "CONFIRMED", "Administrator approval is persisted");
  booking = await success(
    admin,
    "POST",
    "/admin/bookings/" + booking.id + "/actions",
    {
      expectedVersion: booking.version,
      action: "TRANSFER",
      targetSessionId: report.sessions[1],
    },
    randomUUID(),
  );
  check(
    booking.session.id === report.sessions[1],
    "Booking transfers between sessions",
  );
  booking = await success(
    admin,
    "POST",
    "/admin/bookings/" + booking.id + "/actions",
    {
      expectedVersion: booking.version,
      action: "CANCEL",
      reason: "Завершение временной приёмки",
    },
    randomUUID(),
  );
  check(booking.status === "CANCELLED", "Cancellation is persisted");
  await parent.goto(base + "/account/bookings");
  await parent.getByText("Отменено", { exact: true }).waitFor();
  check(
    (await parent.request.get(base + "/api/v1/admin/families")).status() ===
      403,
    "Parent cannot use administrator endpoints",
  );
  const missing = await parent.request.get(base + "/api/v1/public/missing");
  check(
    missing.status() === 404 &&
      missing.headers()["content-type"].includes("application/problem+json"),
    "Unknown API returns a JSON error",
  );
  const cookies = await parent.context().cookies();
  check(
    cookies.some(
      (c) =>
        c.name === "LASTOCHKA_SESSION" &&
        c.secure &&
        c.httpOnly &&
        c.path === "/lastochka",
    ),
    "Session cookie is Secure, HttpOnly and scoped",
  );
  const privateHtml = await (
    await parent.request.get(base + "/account/children")
  ).text();
  check(
    !privateHtml.includes(report.children[0].name),
    "SSR HTML contains no family details",
  );
  for (const width of [375, 1440]) {
    await admin.setViewportSize({ width, height: 1000 });
    await admin.goto(base + "/admin/schedule");
    await admin
      .getByRole("heading", { name: "Расписание студии", exact: true })
      .waitFor();
    check(
      await admin.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      "Administrator layout fits " + width,
    );
    await admin.screenshot({
      path: new URL(
        "../artifacts/server-deploy/0.3.0/admin-" + width + ".png",
        import.meta.url,
      ).pathname,
    });
  }
  // Validate fixture passwords and combined role without enrolling any fixture passkey.
  const tester = await context(false);
  for (const email of [
    "admin1",
    "admin2",
    "doctor1",
    "client1",
    "client2",
    "client3",
    "client4",
  ].map((v) => v + "@lastochka.test")) {
    const state = await success(tester, "POST", "/auth/password-stage", {
      email,
      password: shared,
    });
    check(
      state.state === "FULL",
      "Fixture enters with password without enrolling keys: " + email,
    );
    check((await tester.request.get(base + "/api/v1/children")).status() === 200, "Fixture private access works after password: " + email);
    check((await tester.request.get(base + "/api/v1/admin/families")).status() === (state.account.role === "ADMIN" ? 200 : 403), "Fixture administrator boundary: " + email);
    if (email === "doctor1@lastochka.test")
      check(
        state.account.role === "ADMIN" &&
          state.account.roles.includes("DOCTOR"),
        "Combined doctor role preserves administrator rights",
      );
    await success(tester, "POST", "/auth/logout");
  }
  report.passed = true;
  console.log(
    "Remote public landing, modal password login, optional WebAuthn, booking and seven roles passed",
  );
} catch (error) {
  report.passed = false;
  report.error = String(error.message)
    .replaceAll(shared, "[redacted]")
    .replaceAll(fixture.adminPassword, "[redacted]");
  console.error("Remote acceptance failed: " + report.error);
  process.exitCode = 1;
} finally {
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");
  await browser.close();
}
