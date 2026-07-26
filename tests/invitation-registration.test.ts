import { describe, expect, it } from "vitest";

import { invitationRegistrationSchema } from "../apps/web/src/lib/invitations/invitation-registration";

describe("invitation registration contract", () => {
  it("normalizes the editable account e-mail and requires a 12-character password", () => {
    expect(
      invitationRegistrationSchema.parse({
        email: "  Invitee@Example.COM ",
        password: "a-long-enough-passphrase",
        confirmPassword: "a-long-enough-passphrase",
      }),
    ).toEqual({
      email: "invitee@example.com",
      password: "a-long-enough-passphrase",
      confirmPassword: "a-long-enough-passphrase",
    });
    expect(
      invitationRegistrationSchema.safeParse({
        email: "invitee@example.com",
        password: "short",
        confirmPassword: "short",
      }).success,
    ).toBe(false);
    expect(
      invitationRegistrationSchema.safeParse({
        email: "invitee@example.com",
        password: "a-long-enough-passphrase",
        confirmPassword: "a-different-passphrase",
      }).success,
    ).toBe(false);
  });
});
