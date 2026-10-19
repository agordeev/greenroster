import { describe, expect, it } from "vitest";

import { MarketingShell } from "../apps/web/src/app/marketing-shell";
import NotFound, { metadata } from "../apps/web/src/app/not-found";

function pageText(value: unknown): string {
  const seen = new WeakSet<object>();
  return JSON.stringify(value, (_key, entry: unknown) => {
    if (typeof entry !== "object" || entry === null) return entry;
    if (seen.has(entry)) return "[Circular]";
    seen.add(entry);
    return entry;
  });
}

describe("not-found page", () => {
  it("sits in the public header and footer and offers a way back", () => {
    const page = NotFound();
    const rendered = pageText(page);

    expect(page.type).toBe(MarketingShell);
    expect(rendered).toContain("We can’t find that page");
    expect(rendered).toContain("The link may be old or mistyped.");
    expect(rendered).toContain("Go to the home page");
    expect(rendered).toContain("Try the quota calculator");
    expect(rendered).toContain('"href":"/"');
    expect(rendered).toContain('"href":"/tools/quota-calculator"');
    expect(rendered).toContain('"href":"/guides"');
    expect(rendered).not.toMatch(/dogfight/i);
  });

  it("has its own title and stays out of search results", () => {
    expect(metadata.title).toBe("Page not found · GreenRoster");
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });
});
