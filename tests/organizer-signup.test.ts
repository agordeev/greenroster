import { describe, expect, it, vi } from "vitest";

import {
  organizerBootstrapInputSchema,
  organizerRegistrationSchema,
  runOrganizerBootstrapMutation,
} from "../apps/web/src/lib/auth/organizer-signup";
import {
  createOrganizerSignupCookieValue,
  readOrganizerSignupCookieValue,
} from "../apps/web/src/lib/auth/organizer-signup-state";
import {
  parseSignupSource,
  signupSources,
} from "../apps/web/src/lib/auth/signup-source";

const secret = "organizer-signup-test-secret-with-enough-bytes";
const input = {
  email: " Organizer@Example.COM ",
  password: "a-long-enough-passphrase",
  confirmPassword: "a-long-enough-passphrase",
  acceptedTerms: true,
  acceptedPrivacy: true,
} as const;

describe("organizer signup contract", () => {
  it("normalizes account e-mail and requires both legal confirmations", () => {
    expect(organizerRegistrationSchema.parse(input)).toEqual({
      email: "organizer@example.com",
      password: input.password,
      confirmPassword: input.confirmPassword,
      acceptedTerms: true,
      acceptedPrivacy: true,
    });
    expect(
      organizerRegistrationSchema.safeParse({
        ...input,
        acceptedPrivacy: false,
      }).success,
    ).toBe(false);
  });

  it("accepts an 8-character password and rejects shorter passwords", () => {
    expect(
      organizerRegistrationSchema.safeParse({
        ...input,
        password: "eight!!!",
        confirmPassword: "eight!!!",
      }).success,
    ).toBe(true);
    expect(
      organizerRegistrationSchema.safeParse({
        ...input,
        password: "seven!!",
        confirmPassword: "seven!!",
      }).success,
    ).toBe(false);
  });

  it("validates names and group time zone before the server mutation", () => {
    expect(
      organizerBootstrapInputSchema.safeParse({
        firstName: " Alex ",
        lastName: " Organizer ",
        groupName: " Green Hills ",
        groupTimeZone: " America/New_York ",
        operationId: "30000000-0000-4000-8000-000000000001",
      }),
    ).toMatchObject({ success: true });
    expect(
      organizerBootstrapInputSchema.safeParse({
        firstName: "Alex",
        lastName: "Organizer",
        groupName: "Green Hills",
        groupTimeZone: "Mars/Olympus_Mons",
        operationId: "30000000-0000-4000-8000-000000000001",
      }).success,
    ).toBe(false);
  });

  it("keeps the legal versions in a signed, expiring handoff", () => {
    const cookie = createOrganizerSignupCookieValue(
      {
        termsVersion: "terms-v1",
        privacyVersion: "privacy-v1",
        now: 100,
      },
      secret,
    );

    expect(readOrganizerSignupCookieValue(cookie, secret, 101)).toMatchObject({
      termsVersion: "terms-v1",
      privacyVersion: "privacy-v1",
    });
    expect(
      readOrganizerSignupCookieValue(`${cookie}x`, secret, 101),
    ).toBeNull();
    expect(
      readOrganizerSignupCookieValue(cookie, secret, 100 + 24 * 60 * 60),
    ).toBeNull();
  });

  it("carries the page the organizer came from through the handoff", () => {
    const tagged = createOrganizerSignupCookieValue(
      {
        termsVersion: "terms-v1",
        privacyVersion: "privacy-v1",
        source: "quota-calculator",
        now: 100,
      },
      secret,
    );
    const direct = createOrganizerSignupCookieValue(
      { termsVersion: "terms-v1", privacyVersion: "privacy-v1", now: 100 },
      secret,
    );

    expect(readOrganizerSignupCookieValue(tagged, secret, 101)?.source).toBe(
      "quota-calculator",
    );
    expect(
      readOrganizerSignupCookieValue(direct, secret, 101)?.source,
    ).toBeUndefined();
  });

  it("accepts only the calculator and guide pages as a sign-up source", () => {
    expect(signupSources).toEqual([
      "quota-calculator",
      "quota-game-rules",
      "how-to-calculate-a-golf-quota",
      "how-to-run-a-golf-points-game",
    ]);
    expect(parseSignupSource("quota-calculator")).toBe("quota-calculator");
    expect(parseSignupSource("newsletter")).toBeNull();
    expect(parseSignupSource(["quota-calculator"])).toBeNull();
    expect(parseSignupSource(undefined)).toBeNull();
  });

  it("binds organizer bootstrap to the verified session", async () => {
    const executeBootstrap = vi.fn().mockResolvedValue({
      groupId: "40000000-0000-4000-8000-000000000001",
      administratorMembershipId: "50000000-0000-4000-8000-000000000001",
    });
    const response = await runOrganizerBootstrapMutation(
      {
        firstName: " Alex ",
        lastName: " Organizer ",
        groupName: " Green Hills ",
        groupTimeZone: " America/New_York ",
        operationId: "30000000-0000-4000-8000-000000000001",
      },
      null,
      {
        verifySession: vi.fn().mockResolvedValue({
          userId: "10000000-0000-4000-8000-000000000001",
          emailConfirmedAt: "2026-08-10T00:00:00.000Z",
        }),
        executeBootstrap,
      },
    );

    expect(response.ok).toBe(true);
    expect(executeBootstrap).toHaveBeenCalledWith(
      "10000000-0000-4000-8000-000000000001",
      {
        firstName: "Alex",
        lastName: "Organizer",
        groupName: "Green Hills",
        groupTimeZone: "America/New_York",
        operationId: "30000000-0000-4000-8000-000000000001",
      },
      expect.any(String),
    );
  });

  it("checks the signed legal handoff before creating a group", async () => {
    const executeBootstrap = vi.fn();
    const response = await runOrganizerBootstrapMutation(
      {
        firstName: "Alex",
        lastName: "Organizer",
        groupName: "Green Hills",
        groupTimeZone: "America/New_York",
        operationId: "30000000-0000-4000-8000-000000000001",
      },
      null,
      {
        verifySession: vi.fn().mockResolvedValue({
          userId: "10000000-0000-4000-8000-000000000001",
          emailConfirmedAt: "2026-08-10T00:00:00.000Z",
        }),
        verifyLegalHandoff: vi.fn(async () => {
          throw new Error("missing signed handoff");
        }),
        executeBootstrap,
      },
    );

    expect(response.ok).toBe(false);
    expect(executeBootstrap).not.toHaveBeenCalled();
  });
});
