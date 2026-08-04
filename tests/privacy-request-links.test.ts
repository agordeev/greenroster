import { describe, expect, it } from "vitest";

import { buildPrivacyRequestMailto } from "../apps/web/src/lib/privacy/privacy-request-links";

describe("privacy request links", () => {
  it("targets the configured privacy owner without leaking unrelated data", () => {
    expect(
      buildPrivacyRequestMailto(
        "privacy@example.test",
        "member@example.test",
        "data_access",
      ),
    ).toBe(
      "mailto:privacy@example.test?subject=GreenRoster%20data%20access%20request&body=Please%20provide%20a%20copy%20of%20the%20personal%20data%20associated%20with%20my%20GreenRoster%20account.%0A%0AAccount%20e-mail%3A%20member%40example.test",
    );
  });

  it("explains retained sporting history for deletion requests", () => {
    expect(
      buildPrivacyRequestMailto(
        "privacy@example.test",
        "member@example.test",
        "account_deletion",
      ),
    ).toContain("pseudonymized%20sporting%20history");
  });
});
