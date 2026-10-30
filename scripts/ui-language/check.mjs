import { readFileSync, readdirSync } from "node:fs";
import { resolve, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(resolve(root, "frontend/package.json"));
const ts = require("typescript");
export const policy = JSON.parse(
  readFileSync(resolve(root, "scripts/ui-language/policy.json"), "utf8"),
);
const words = /[A-Za-z]+(?:-[A-Za-z]+)*/g;
const boundary = (pattern) =>
  new RegExp(`(?<![\\p{L}\\p{N}_])(?:${pattern})(?![\\p{L}\\p{N}_])`, "giu");
export function checkText(text, file, line = 1) {
  const errors = [];
  // Only actual addresses, URLs and version numbers, not arbitrary Latin instructions.
  let value = text
    .replace(/https?:\/\/[^\s<>"']+/g, "")
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "")
    .replace(/\bv?\d+(?:\.\d+)+\b/g, "");
  for (const entry of policy.forbidden) {
    for (const match of value.matchAll(boundary(entry.pattern)))
      errors.push({
        file,
        line,
        word: match[0],
        replacement: entry.replacement,
        reason: "непонятный термин",
      });
    value = value.replace(boundary(entry.pattern), "");
  }
  for (const match of value.matchAll(words)) {
    const permitted = policy.allowed.some(
      (item) =>
        item.word === match[0] &&
        item.files.includes(file) &&
        item.reason.trim(),
    );
    if (!permitted)
      errors.push({
        file,
        line,
        word: match[0],
        replacement: "русская формулировка",
        reason: "неразрешённое английское слово",
      });
  }
  return errors;
}
function filesUnder(folder) {
  return readdirSync(folder, { withFileTypes: true }).flatMap((d) =>
    d.isDirectory()
      ? filesUnder(resolve(folder, d.name))
      : [resolve(folder, d.name)],
  );
}
const visibleAttrs = new Set([
  "title",
  "placeholder",
  "alt",
  "aria-label",
  "aria-description",
  "aria-valuetext",
  "aria-roledescription",
  "aria-placeholder",
  "label",
  "message",
  "description",
]);
export function extractTypeScript(files) {
  const program = ts.createProgram(files, {
    target: ts.ScriptTarget.ESNext,
    jsx: ts.JsxEmit.Preserve,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    allowJs: true,
    skipLibCheck: true,
  });
  const checker = program.getTypeChecker();
  const output = [];
  const recorded = new Set();
  const states = new Map();
  function record(node, text = node.text) {
    const sf = node.getSourceFile();
    const key = `${sf.fileName}:${node.pos}:${text}`;
    if (recorded.has(key)) return;
    recorded.add(key);
    output.push({
      file: relative(root, sf.fileName).replaceAll("\\", "/"),
      line: sf.getLineAndCharacterOfPosition(node.getStart()).line + 1,
      text,
    });
  }
  const sources = files.map((f) => program.getSourceFile(f)).filter(Boolean);
  for (const sf of sources) {
    const setters = new Map();
    function index(n) {
      if (
        ts.isVariableDeclaration(n) &&
        ts.isArrayBindingPattern(n.name) &&
        n.initializer &&
        ts.isCallExpression(n.initializer) &&
        n.initializer.expression.getText(sf) === "useState"
      ) {
        const [state, setter] = n.name.elements;
        if (state && setter) {
          const values = [...n.initializer.arguments];
          states.set(checker.getSymbolAtLocation(state.name), values);
          setters.set(setter.name.getText(sf), values);
        }
      }
      ts.forEachChild(n, index);
    }
    index(sf);
    function calls(n) {
      if (
        ts.isCallExpression(n) &&
        ts.isIdentifier(n.expression) &&
        setters.has(n.expression.text)
      )
        setters.get(n.expression.text).push(...n.arguments);
      ts.forEachChild(n, calls);
    }
    calls(sf);
  }
  function trace(n, seen = new Set()) {
    if (!n || seen.has(n)) return;
    const next = new Set(seen);
    next.add(n);
    if (ts.isStringLiteralLike(n)) {
      record(n);
      return;
    }
    if (ts.isJsxText(n)) {
      record(n, n.text);
      return;
    }
    if (ts.isTemplateExpression(n)) {
      record(n.head);
      for (const s of n.templateSpans) {
        record(s.literal);
        trace(s.expression, next);
      }
      return;
    }
    if (ts.isConditionalExpression(n)) {
      trace(n.whenTrue, next);
      trace(n.whenFalse, next);
      return;
    }
    if (ts.isBinaryExpression(n)) {
      if (n.operatorToken.kind !== ts.SyntaxKind.AmpersandAmpersandToken)
        trace(n.left, next);
      trace(n.right, next);
      return;
    }
    if (
      ts.isParenthesizedExpression(n) ||
      ts.isAsExpression(n) ||
      ts.isNonNullExpression(n) ||
      ts.isJsxExpression(n)
    ) {
      trace(n.expression, next);
      return;
    }
    if (ts.isArrayLiteralExpression(n)) {
      for (const e of n.elements) trace(e, next);
      return;
    }
    if (ts.isObjectLiteralExpression(n)) {
      for (const p of n.properties)
        if (ts.isPropertyAssignment(p)) trace(p.initializer, next);
      return;
    }
    if (
      ts.isArrowFunction(n) ||
      ts.isFunctionExpression(n) ||
      ts.isFunctionDeclaration(n)
    ) {
      if (n.body && !ts.isBlock(n.body)) trace(n.body, next);
      else if (n.body) {
        const returns = (a) => {
          if (ts.isReturnStatement(a)) trace(a.expression, next);
          else if (!ts.isFunctionLike(a)) ts.forEachChild(a, returns);
        };
        ts.forEachChild(n.body, returns);
      }
      return;
    }
    if (ts.isCallExpression(n) || ts.isNewExpression(n)) {
      const name = n.expression.getText();
      if (/^(?:UserFacingError|Response|Error)$/.test(name))
        trace(n.arguments?.[0], next);
      else trace(n.expression, next);
      return;
    }
    if (ts.isElementAccessExpression(n)) {
      trace(n.expression, next);
      return;
    }
    if (ts.isPropertyAccessExpression(n) || ts.isIdentifier(n)) {
      let symbol = checker.getSymbolAtLocation(
        ts.isPropertyAccessExpression(n) ? n.name : n,
      );
      if (symbol?.flags & ts.SymbolFlags.Alias)
        symbol = checker.getAliasedSymbol(symbol);
      if (states.has(symbol))
        for (const v of states.get(symbol)) trace(v, next);
      const d = symbol?.valueDeclaration;
      if (d && files.includes(d.getSourceFile().fileName)) {
        if (
          ts.isVariableDeclaration(d) ||
          ts.isPropertyAssignment(d) ||
          ts.isPropertyDeclaration(d)
        )
          trace(d.initializer, next);
        else if (ts.isBindingElement(d) && d.initializer)
          trace(d.initializer, next);
        else if (ts.isFunctionLike(d)) trace(d, next);
      }
    }
  }
  for (const sf of sources) {
    function visit(n) {
      if (ts.isJsxText(n)) trace(n);
      if (
        ts.isJsxExpression(n) &&
        !ts.isJsxAttribute(n.parent) &&
        !(
          ts.isJsxElement(n.parent) &&
          ["style", "script"].includes(
            n.parent.openingElement.tagName.getText(sf),
          )
        )
      )
        trace(n.expression);
      if (ts.isJsxAttribute(n) && visibleAttrs.has(n.name.getText(sf)))
        trace(n.initializer);
      if (
        ts.isNewExpression(n) &&
        n.expression.getText(sf) === "UserFacingError"
      )
        trace(n.arguments?.[0]);
      if (
        ts.isPropertyAssignment(n) &&
        [
          "title",
          "message",
          "detail",
          "label",
          "text",
          "notice",
          "placeholder",
        ].includes(n.name.getText(sf).replace(/["']/g, ""))
      )
        trace(n.initializer);
      if (
        ts.isBinaryExpression(n) &&
        n.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        /\.(?:textContent|innerText|innerHTML|notice|message|label|title)$/.test(
          n.left.getText(sf),
        )
      )
        trace(n.right);
      if (
        ts.isCallExpression(n) &&
        /\.setAttribute$/.test(n.expression.getText(sf)) &&
        n.arguments[0] &&
        ts.isStringLiteral(n.arguments[0]) &&
        visibleAttrs.has(n.arguments[0].text)
      )
        trace(n.arguments[1]);
      // Russian literals are product wording even if not directly reachable through a JSX sink.
      if (ts.isStringLiteralLike(n) && /[А-Яа-яЁё]/.test(n.text)) trace(n);
      if (sf.fileName.endsWith("/ui-texts.ts") && ts.isPropertyAssignment(n))
        trace(n.initializer);
      ts.forEachChild(n, visit);
    }
    visit(sf);
  }
  return output;
}
function extractHtml(source, file) {
  const chunks = [];
  const add = (text, index) =>
    chunks.push({
      text,
      file,
      line: source.slice(0, index).split("\n").length,
    });
  const expression = (text, index) => {
    const sf = ts.createSourceFile(
      "expression.ts",
      text,
      ts.ScriptTarget.Latest,
      true,
    );
    const walk = (n) => {
      if (ts.isStringLiteralLike(n)) add(n.text, index);
      ts.forEachChild(n, walk);
    };
    walk(sf);
  };
  source
    .replace(/<!--[^]*?-->/g, (m) => " ".repeat(m.length))
    .replace(/<(?:[^"'<>]|"[^"]*"|'[^']*')*>|[^<]+/g, (part, index) => {
      if (part.startsWith("<")) {
        for (const a of part.matchAll(/([\w:-]+)\s*=\s*(["'])([^]*?)\2/g)) {
          if (visibleAttrs.has(a[1])) add(a[3], index);
          else if (["ng-bind", "ng-bind-html"].includes(a[1]))
            expression(a[3], index);
        }
      } else {
        add(
          part
            .replace(/{{([^]*?)}}/g, (_, e) => {
              expression(e, index);
              return "";
            })
            .replace(/&(?:[a-z]+|#\d+);/gi, ""),
          index,
        );
      }
      return part;
    });
  return chunks;
}
function kotlinStrings(source) {
  const result = [];
  let i = 0;
  function quoted() {
    const index = i;
    const triple = source.startsWith('"""', i);
    i += triple ? 3 : 1;
    let text = "";
    while (i < source.length) {
      if (source.startsWith(triple ? '"""' : '"', i)) {
        i += triple ? 3 : 1;
        break;
      }
      if (source[i] === "\\" && !triple) {
        text += source.slice(i, i + 2);
        i += 2;
        continue;
      }
      if (source.startsWith("${", i)) {
        i += 2;
        let depth = 1;
        while (i < source.length && depth) {
          if (source[i] === '"') {
            quoted();
            continue;
          }
          if (source[i] === "{") depth++;
          if (source[i] === "}") depth--;
          i++;
        }
        continue;
      }
      if (source[i] === "$" && /[A-Za-z_]/.test(source[i + 1] ?? "")) {
        i++;
        while (/\w/.test(source[i] ?? "")) i++;
        continue;
      }
      text += source[i++];
    }
    return { text, index };
  }
  while (i < source.length) {
    if (source.startsWith("//", i)) {
      const end = source.indexOf("\n", i);
      i = end < 0 ? source.length : end;
    } else if (source.startsWith("/*", i)) {
      const end = source.indexOf("*/", i + 2);
      i = end < 0 ? source.length : end + 2;
    } else if (source[i] === '"') result.push(quoted());
    else if (source[i] === "'") {
      i++;
      while (i < source.length) {
        if (source[i++] === "'") break;
      }
    } else i++;
  }
  return result;
}
export function scanProject() {
  const tsFiles = filesUnder(resolve(root, "frontend/app")).filter(
    (f) => /\.[jt]sx?$/.test(f) && !f.endsWith(".d.ts"),
  );
  const chunks = extractTypeScript(tsFiles);

  for (const full of filesUnder(resolve(root, "frontend/app")).filter((f) =>
    f.endsWith(".css"),
  )) {
    const css = readFileSync(full, "utf8");
    for (const m of css.matchAll(/\bcontent\s*:\s*(["'])(.*?)\1/g))
      chunks.push({
        file: relative(root, full),
        line: css.slice(0, m.index).split("\n").length,
        text: m[2].replace(/\\([0-9a-fA-F]{1,6})\s?/g, (_, v) =>
          String.fromCodePoint(parseInt(v, 16)),
        ),
      });
  }
  for (const full of filesUnder(resolve(root, "backend")).filter(
    (f) => f.includes("/src/main/") && !f.includes("/build/"),
  )) {
    const file = relative(root, full);
    const source = readFileSync(full, "utf8");
    if (full.endsWith(".properties"))
      for (const [i, line] of source.split("\n").entries())
        if (line.trim() && !line.trim().startsWith("#") && line.includes("="))
          chunks.push({
            file,
            line: i + 1,
            text: line
              .slice(line.indexOf("=") + 1)
              .replace(/\\[nrt]/g, " ")
              .replace(/\\ /g, " ")
              .replace(/\/(?:account|auth)\/[^\s]*/g, ""),
          });
    if (full.endsWith(".kt") && !full.endsWith("OpenApiConfiguration.kt")) {
      // Kotlin public text: responses and email wording. SQL, config and API documentation aren't UI.
      for (const { text: raw, index } of kotlinStrings(source)) {
        const before = source.slice(Math.max(0, index - 100), index);
        if (/\bdescription\s*=\s*$/.test(before)) continue; // OpenAPI documentation, never a public response.
        if (/[А-Яа-яЁё]/.test(raw) || /MessageResponse\(\s*$/.test(before)) {
          chunks.push({
            file,
            line: source.slice(0, index).split("\n").length,
            text: raw
              .replace(/\\[nrt]/g, " ")
              .replace(/\/(?:account|auth)\/[^\s]*/g, ""),
          });
        }
      }
    }
  }
  const errors = chunks.flatMap(({ text, file, line }) =>
    checkText(text, file, line),
  );
  // A new raw React form would bring back browser-language validation.
  for (const full of tsFiles) {
    if (full.endsWith("/ui/russian-form.tsx")) continue;
    const sf = ts.createSourceFile(
      full,
      readFileSync(full, "utf8"),
      ts.ScriptTarget.Latest,
      true,
      full.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const visit = (n) => {
      if (
        (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) &&
        n.tagName.getText(sf) === "form"
      )
        errors.push({
          file: relative(root, full),
          line: sf.getLineAndCharacterOfPosition(n.getStart()).line + 1,
          word: "form",
          reason: "форма без общей русской проверки",
          replacement: "RussianForm",
        });
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return { errors, chunks };
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const { errors, chunks } = scanProject();
  for (const e of errors)
    console.error(
      `${e.file}:${e.line}: «${e.word}»: ${e.reason}; используйте: ${e.replacement}`,
    );
  console.log(
    `Проверено пользовательских фрагментов: ${chunks.length}; нарушений: ${errors.length}.`,
  );
  if (process.argv.includes("--inventory"))
    console.log(JSON.stringify(chunks, null, 2));
  process.exitCode = errors.length ? 1 : 0;
}
