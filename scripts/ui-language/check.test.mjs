import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  writeFileSync,
  rmSync,
  readFileSync,
  existsSync,
  chmodSync,
} from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { checkText, extractTypeScript, scanProject } from "./check.mjs";
const root = resolve(import.meta.dirname, "../..");
test("words, jargon, narrow exemptions, URLs and addresses", () => {
  assert.equal(
    checkText(
      "Напишите на user@example.test: https://example.test/path",
      "file",
      1,
    ).length,
    0,
  );
  assert.equal(checkText("Предпросмотр для ребёнка", "file").length, 0);
  for (const text of [
    "Please enter your email",
    "Unforeseenword",
    "валидации",
    "Аутентификация",
    "токеном",
    "passkey",
    "preview",
  ])
    assert.ok(checkText(text, "file").length, text);
  assert.equal(
    checkText("MailHog — почта", "infra/mailhog-public/ui/index.html").length > 0,
    true,
  );
  assert.ok(
    checkText(
      "MailHog Please enter",
      "infra/mailhog-public/ui/index.html",
    ).some((x) => x.word === "Please"),
  );
  assert.ok(checkText("MailHog", "frontend/app/ui/new.tsx").length);
});
test("AST follows identifiers, branches, maps, imported catalogs, calls and state setters", () => {
  const dir = mkdtempSync(
    resolve(root, "runtime-data/russian-feedback/scanner-"),
  );
  try {
    const main = resolve(dir, "main.tsx"),
      catalog = resolve(dir, "catalog.ts");
    writeFileSync(catalog, `export const labels = {help: 'Please choose'};`);
    writeFileSync(
      main,
      `import {labels} from './catalog';
      const message='Wrong address'; const metadata={ email:'internal' };
      const titles={reset:'Reset password'};const list=['Select here'];
      function helper(){return 'Try again'}
      function C(){ const [notice,setNotice]=useState(''); setNotice('Validation failed');
      return <><p>{message}</p><input placeholder={labels.help}/><p>{true?'Enter value':'Goodbye'}</p>
      <p>{titles[action]}</p><p>{list[0]}</p><p>{helper()}</p><p>{notice}</p><p>{\`Hello \${message}\`}</p></> }`,
    );
    const chunks = extractTypeScript([main, catalog]);
    const text = chunks.map((x) => x.text).join(" ");
    for (const s of [
      "Please choose",
      "Wrong address",
      "Reset password",
      "Select here",
      "Try again",
      "Validation failed",
      "Enter value",
      "Goodbye",
      "Hello ",
    ])
      assert.ok(text.includes(s), s);
    assert.ok(!text.includes("internal"));
    assert.ok(!text.includes("./catalog"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("new violations block project check, production build and each packaging entry before Docker", () => {
  const fixture = resolve(root, "frontend/app/ui/language-gate-probe.tsx");
  const dir = mkdtempSync(resolve(root, "runtime-data/russian-feedback/gate-"));
  assert.ok(!existsSync(fixture));
  const marker = resolve(dir, "docker-ran");
  writeFileSync(
    resolve(dir, "docker"),
    `#!/bin/sh\ntouch '${marker}'\nexit 97\n`,
  );
  chmodSync(resolve(dir, "docker"), 0o755);
  const env = {
    ...process.env,
    PATH: dir + ":" + process.env.PATH,
    LASTOCHKA_NODE: process.execPath,
  };
  try {
    writeFileSync(
      fixture,
      `export const Probe=()=> <p>Please enter your email</p>;`,
    );
    const commands = [
      [process.execPath, ["scripts/ui-language/check.mjs"]],
      ["npm", ["--prefix", "frontend", "run", "build"]],
      ["bash", ["scripts/package-frontend-release.sh", "language-gate-probe"]],
      ["bash", ["scripts/package-release.sh", "language-gate-probe"]],
    ];
    for (const [command, args] of commands) {
      const r = spawnSync(command, args, { cwd: root, env, encoding: "utf8" });
      assert.notEqual(r.status, 0, command + " " + args.join(" "));
      assert.match(r.stdout + r.stderr, /language-gate-probe.tsx/);
      assert.match(r.stdout + r.stderr, /Please/);
      assert.ok(!existsSync(marker), "Docker must never run");
    }
    // Same sink with Cyrillic jargon also fails, rather than checking only Latin letters.
    writeFileSync(fixture, `export const Probe=()=> <p>Ошибка валидации</p>;`);
    assert.ok(scanProject().errors.some((x) => x.word === "валидации"));
    writeFileSync(
      fixture,
      `export const Probe=()=> <form><input required /></form>;`,
    );
    assert.ok(scanProject().errors.some((x) => x.word === "form"));
  } finally {
    rmSync(fixture, { force: true });
    rmSync(dir, { recursive: true, force: true });
  }
  assert.equal(scanProject().errors.length, 0);
});

test("common backend catalogs stay checked while property escapes and URL templates are data", () => {
  const file = resolve(
    root,
    "backend/common/src/main/resources/language-gate-probe.properties",
  );
  assert.ok(!existsSync(file));
  try {
    writeFileSync(
      file,
      "HELP=Please choose\\nСсылка: {0}/auth/verify#token={1}\n",
    );
    assert.ok(
      scanProject().errors.some(
        (error) =>
          error.file.endsWith("language-gate-probe.properties") &&
          error.word === "Please",
      ),
    );
    writeFileSync(
      file,
      "HELP=Откройте ссылку.\\nСсылка: {0}/auth/verify#token={1}\n",
    );
    assert.equal(
      scanProject().errors.filter((error) =>
        error.file.endsWith("language-gate-probe.properties"),
      ).length,
      0,
    );
  } finally {
    rmSync(file, { force: true });
  }
});
