import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const termsPath = fileURLToPath(
  new URL("../apps/web/src/app/terms/page.tsx", import.meta.url),
);
const privacyPath = fileURLToPath(
  new URL("../apps/web/src/app/privacy/page.tsx", import.meta.url),
);

describe("public legal pages", () => {
  it("publish a current Terms of Use instead of the signup placeholder", () => {
    const source = readFileSync(termsPath, "utf8");

    expect(source).toContain('title="Terms of Use"');
    expect(source).toContain("TERMS_VERSION");
    expect(source).toContain("You protect your account");
    expect(source).toContain("You review a new version");
    expect(source).not.toContain("awaiting approval");
  });

  it("publish a current Privacy Policy instead of the signup placeholder", () => {
    const source = readFileSync(privacyPath, "utf8");

    expect(source).toContain('title="Privacy Policy"');
    expect(source).toContain("PRIVACY_VERSION");
    expect(source).toContain("You keep control of your information");
    expect(source).toContain("You request a copy");
    expect(source).not.toContain("awaiting approval");
  });
});
