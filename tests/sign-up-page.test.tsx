import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveLegal: vi.fn(),
}));

vi.mock("../apps/web/src/lib/auth/organizer-signup-data", () => ({
  resolveCurrentLegalDocuments: mocks.resolveLegal,
}));

vi.mock("../apps/web/src/app/sign-up/signup-form", () => ({
  OrganizerSignupForm: (props: Record<string, unknown>) => ({
    type: "organizer-signup-form",
    props,
  }),
}));

import SignupPage from "../apps/web/src/app/sign-up/page";

function pageText(value: unknown): string {
  const seen = new WeakSet<object>();
  return JSON.stringify(value, (_key, entry: unknown) => {
    if (typeof entry !== "object" || entry === null) return entry;
    if (seen.has(entry)) return "[Circular]";
    seen.add(entry);
    return entry;
  });
}

describe("organizer signup page", () => {
  it("explains the deployment-owned legal gate when versions are absent", async () => {
    mocks.resolveLegal.mockResolvedValueOnce(null);

    const page = await SignupPage({
      searchParams: Promise.resolve({}),
    });

    const rendered = pageText(page);
    expect(rendered).toContain(
      "Our Terms of Use and Privacy Policy aren't published",
    );
    expect(rendered).toContain("The sign-up form will appear");
    expect(rendered).toContain('"/terms"');
    expect(rendered).toContain('"/privacy"');
  });

  it("renders the registration form only after legal versions resolve", async () => {
    mocks.resolveLegal.mockResolvedValueOnce({
      termsVersion: "terms-v1",
      privacyVersion: "privacy-v1",
    });

    const page = await SignupPage({
      searchParams: Promise.resolve({}),
    });

    expect(pageText(page)).not.toContain("aren't published");
    expect(pageText(page)).not.toContain("The sign-up form will appear");
  });
});
