import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const sourceRoot = fileURLToPath(new URL("../apps/web/src", import.meta.url));

function cssFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) return cssFiles(path);
    return entry.name.endsWith(".css") ? [path] : [];
  });
}

// Selectors of every style rule, including rules nested inside at-rules such
// as @layer and @media. At-rule preludes (for example the dark variant) are
// not selectors and are skipped.
function ruleSelectors(css: string): string[] {
  const selectors: string[] = [];
  const source = css.replace(/\/\*[\s\S]*?\*\//gu, "");
  let prelude = "";
  for (const character of source) {
    if (character === "{") {
      const selector = prelude.trim();
      if (selector && !selector.startsWith("@")) selectors.push(selector);
      prelude = "";
    } else if (character === "}" || character === ";") {
      prelude = "";
    } else {
      prelude += character;
    }
  }
  return selectors;
}

describe("web styling guard", () => {
  it("keeps globals.css as the only stylesheet in the web source", () => {
    expect(
      cssFiles(sourceRoot).map((path) => path.slice(sourceRoot.length)),
    ).toEqual(["/app/globals.css"]);
  });

  it("keeps class selectors out of globals.css", () => {
    const selectors = ruleSelectors(
      readFileSync(`${sourceRoot}/app/globals.css`, "utf8"),
    );
    const withoutAttributes = (selector: string) =>
      selector.replace(/\[[^\]]*\]/gu, "");

    expect(selectors.length).toBeGreaterThan(0);
    expect(
      selectors.filter((selector) =>
        /\.[A-Za-z_-]/u.test(withoutAttributes(selector)),
      ),
    ).toEqual([]);
  });
});
