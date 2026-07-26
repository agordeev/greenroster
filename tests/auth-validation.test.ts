import { describe, expect, it } from "vitest";

import {
  credentialsSchema,
  passwordResetSchema,
  recoverySchema,
} from "../apps/web/src/lib/auth/auth-validation";
import { recoveryDestination } from "../apps/web/src/lib/auth/recovery-callback";
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

  it("requires a 12-character matching replacement password", () => {
    expect(
      passwordResetSchema.safeParse({
        password: "too-short",
        confirmPassword: "too-short",
      }).success,
    ).toBe(false);
    expect(
      passwordResetSchema.safeParse({
        password: "twelve-or-more",
        confirmPassword: "different-value",
      }).success,
    ).toBe(false);
    expect(
      passwordResetSchema.safeParse({
        password: "twelve-or-more",
        confirmPassword: "twelve-or-more",
      }).success,
    ).toBe(true);
  });

  it("allows only the password reset callback destination", () => {
    expect(recoveryDestination("/reset-password")).toBe("/reset-password");
    expect(recoveryDestination("https://attacker.example")).toBeNull();
    expect(recoveryDestination("//attacker.example")).toBeNull();
    expect(recoveryDestination(null)).toBeNull();
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
    expect(passwordRecoveryStateFromRow(null, now)).toBe("none");
  });
});
