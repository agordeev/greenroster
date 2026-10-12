import { describe, expect, it } from "vitest";

import {
  credentialsSchema,
  passwordResetSchema,
  recoverySchema,
} from "../apps/web/src/lib/auth/auth-validation";
import { recoveryDestination } from "../apps/web/src/lib/auth/recovery-callback";
import {
  memberAuthDestination,
  resolveSafeReturnPath,
  signInPath,
} from "../apps/web/src/lib/auth/safe-return-path";
import { passwordRecoveryStateFromRow } from "../apps/web/src/lib/auth/password-recovery-state";
import { resolveBootstrapOperationId } from "../apps/web/src/lib/groups/bootstrap-operation";

describe("authentication input contracts", () => {
  it("normalizes an account e-mail before validating it", () => {
    expect(
      credentialsSchema.parse({
        email: "  Administrator@Example.COM ",
        password: "person-specific",
      }),
    ).toEqual({
      email: "administrator@example.com",
      password: "person-specific",
    });

    expect(recoverySchema.parse({ email: " USER@Example.com " })).toEqual({
      email: "user@example.com",
    });
  });

  it("requires an 8-character matching replacement password", () => {
    expect(
      passwordResetSchema.safeParse({
        password: "seven!!",
        confirmPassword: "seven!!",
      }).success,
    ).toBe(false);
    expect(
      passwordResetSchema.safeParse({
        password: "eight!!!",
        confirmPassword: "different-value",
      }).success,
    ).toBe(false);
    expect(
      passwordResetSchema.safeParse({
        password: "eight!!!",
        confirmPassword: "eight!!!",
      }).success,
    ).toBe(true);
  });

  it("allows only the password reset callback destination", () => {
    expect(recoveryDestination("/reset-password")).toBe("/reset-password");
    expect(recoveryDestination("https://attacker.example")).toBeNull();
    expect(recoveryDestination("//attacker.example")).toBeNull();
    expect(recoveryDestination(null)).toBeNull();
  });

  it("allows only member routes as magic-link callback destinations", () => {
    expect(memberAuthDestination("/member/home")).toBe("/member/home");
    expect(
      memberAuthDestination(
        "/member/results?round_id=10000000-0000-4000-8000-000000000001",
      ),
    ).toBe("/member/results?round_id=10000000-0000-4000-8000-000000000001");
    expect(memberAuthDestination("/portal")).toBeNull();
    expect(memberAuthDestination("https://attacker.example")).toBeNull();
  });

  it("preserves only parameter-free protected portal return paths", () => {
    expect(resolveSafeReturnPath("/portal")).toBe("/portal");
    expect(resolveSafeReturnPath("/portal/account-settings")).toBe(
      "/portal/account-settings",
    );
    expect(resolveSafeReturnPath("/portal/members?status=inactive")).toBe(
      "/portal",
    );
    expect(resolveSafeReturnPath("//attacker.example/portal")).toBe("/portal");
    expect(resolveSafeReturnPath("https://attacker.example/portal")).toBe(
      "/portal",
    );
    expect(resolveSafeReturnPath("/portal/../admin")).toBe("/portal");
    expect(signInPath("/portal/account")).toBe(
      "/sign-in?next=%2Fportal%2Faccount",
    );
  });

  it("allows only exact member destinations and validated result queries", () => {
    expect(resolveSafeReturnPath("/invitations/accept")).toBe(
      "/invitations/accept",
    );
    expect(resolveSafeReturnPath("/member/first-run")).toBe(
      "/member/first-run",
    );
    expect(resolveSafeReturnPath("/member/home")).toBe("/member/home");
    expect(resolveSafeReturnPath("/member/results")).toBe("/member/results");
    expect(
      resolveSafeReturnPath(
        "/member/rounds/10000000-0000-4000-8000-000000000001",
      ),
    ).toBe("/member/rounds/10000000-0000-4000-8000-000000000001");
    expect(
      resolveSafeReturnPath(
        "/member/results?round_id=10000000-0000-4000-8000-000000000001",
      ),
    ).toBe("/member/results?round_id=10000000-0000-4000-8000-000000000001");
    expect(resolveSafeReturnPath("/member/standings")).toBe(
      "/member/standings",
    );
    expect(resolveSafeReturnPath("/member/profile")).toBe("/member/profile");
    expect(resolveSafeReturnPath("/member/inbox")).toBe("/member/inbox");
    expect(resolveSafeReturnPath("/member/directory")).toBe(
      "/member/directory",
    );
    expect(resolveSafeReturnPath("/member/home?admin=true")).toBe("/portal");
    expect(resolveSafeReturnPath("/member/results?round_id=not-a-uuid")).toBe(
      "/portal",
    );
    expect(resolveSafeReturnPath("/member/rounds/not-a-uuid")).toBe("/portal");
    expect(
      resolveSafeReturnPath(
        "/member/rounds/10000000-0000-4000-8000-000000000001?admin=true",
      ),
    ).toBe("/portal");
    expect(resolveSafeReturnPath("/member/home/extra")).toBe("/portal");
    expect(resolveSafeReturnPath("/account")).toBe("/account");
    expect(resolveSafeReturnPath("/account/privacy")).toBe("/account/privacy");
    expect(resolveSafeReturnPath("/account?admin=true")).toBe("/portal");
  });

  it("keeps a valid group-bootstrap operation across a reload", () => {
    const prior = "30000000-0000-4000-8000-000000000001";
    const generated = "30000000-0000-4000-8000-000000000002";

    expect(resolveBootstrapOperationId(prior, () => generated)).toBe(prior);
    expect(
      resolveBootstrapOperationId("not-an-operation-id", () => generated),
    ).toBe(generated);
  });

  it("derives recovery state from PostgREST offset timestamps", () => {
    const now = new Date("2026-07-26T02:00:00Z");

    expect(
      passwordRecoveryStateFromRow(
        {
          claim_id: null,
          consumed_at: null,
          expires_at: "2026-07-26T03:00:00+00:00",
        },
        now,
      ),
    ).toBe("active");
    expect(
      passwordRecoveryStateFromRow(
        {
          claim_id: "30000000-0000-4000-8000-000000000001",
          consumed_at: null,
          expires_at: "2026-07-26T03:00:00+00:00",
        },
        now,
      ),
    ).toBe("claimed");
    expect(
      passwordRecoveryStateFromRow(
        {
          claim_id: "30000000-0000-4000-8000-000000000001",
          consumed_at: null,
          expires_at: "2026-07-26T01:59:59+00:00",
        },
        now,
      ),
    ).toBe("expired");
    expect(passwordRecoveryStateFromRow(null, now)).toBe("none");
  });
});
