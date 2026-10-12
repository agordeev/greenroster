import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// Guards the "Never ship" list in AGENTS.md: words that describe how the
// software is built must not appear in text a person reads. Only unambiguous
// words are checked; the rest of the rule still needs a human copy pass.
const require = createRequire(
  fileURLToPath(new URL("../apps/web/package.json", import.meta.url)),
);
const ts = require("typescript") as typeof import("typescript");

const root = fileURLToPath(new URL("..", import.meta.url));
const screens = [
  "apps/web/src/app",
  "apps/web/src/components",
  "apps/web/src/emails",
];
// Legal documents use their own vocabulary.
const skipped = ["apps/web/src/app/privacy/", "apps/web/src/app/terms/"];
const textAttributes = new Set([
  "aria-label",
  "alt",
  "placeholder",
  "title",
  "label",
  "accessibilityLabel",
  "accessibilityHint",
]);
const banned =
  /\b(identity|entity|entities|payload|provider|session|surface|boundary|member-safe|person-specific|isolated|granular|authoritative|snapshots?|the server|server-\w+|seamless(ly)?|powerful|effortless(ly)?|streamlined?|unlock|robust|intuitive|comprehensive)\b/i;

const sentence = /[A-Za-z]+ [a-z]+ [a-z]+/;

function tsxFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return tsxFiles(path);
    return entry.name.endsWith(".tsx") ? [path] : [];
  });
}

function readableText(path: string): string[] {
  const source = ts.createSourceFile(
    path,
    readFileSync(path, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const found: string[] = [];
  const visit = (node: import("typescript").Node) => {
    if (ts.isJsxText(node)) {
      found.push(node.text);
    } else if (
      ts.isStringLiteralLike(node) &&
      ts.isJsxAttribute(node.parent) &&
      textAttributes.has(node.parent.name.getText())
    ) {
      found.push(node.text);
    } else if (
      (ts.isStringLiteralLike(node) || ts.isTemplateLiteralToken(node)) &&
      !ts.isJsxAttribute(node.parent) &&
      !ts.isImportDeclaration(node.parent) &&
      sentence.test(node.text.trim())
    ) {
      // Messages set from code: anything that reads like a sentence.
      found.push(node.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found.map((text) => text.replace(/\s+/g, " ").trim()).filter(Boolean);
}

describe("user-facing copy", () => {
  it("keeps implementation and filler words off the screen", () => {
    const violations = screens
      .flatMap((directory) => tsxFiles(join(root, directory)))
      .map((path) => ({ path, file: relative(root, path) }))
      .filter(({ file }) => !skipped.some((prefix) => file.startsWith(prefix)))
      .flatMap(({ path, file }) =>
        readableText(path)
          .filter((text) => banned.test(text))
          .map((text) => `${file}: ${text}`),
      );

    expect(violations).toEqual([]);
  });
});
