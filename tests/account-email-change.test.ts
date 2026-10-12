import { describe, expect, it, vi } from "vitest";

import { runAccountEmailChange } from "../apps/web/src/lib/auth/account-email-change";
import { resolveEmailChangeConfirmation } from "../apps/web/src/lib/auth/email-change-confirmation";
import { shouldScrubEmailChangeConfirmation } from "../apps/web/src/lib/auth/email-change-confirmation";
import { MutationError } from "../apps/web/src/lib/mutations/result";

const userId = "10000000-0000-4000-8000-000000000001";

describe("verified account e-mail change boundary", () => {
  it("reports provider redirect failures without claiming confirmation", () => {
    expect(
      resolveEmailChangeConfirmation(
        "",
        "#error=access_denied&error_code=otp_expired",
      ),
    ).toMatchObject({ status: "error" });
    expect(resolveEmailChangeConfirmation("", "")).toMatchObject({
      status: "submitted",
    });
    expect(shouldScrubEmailChangeConfirmation("?code=one-time-code", "")).toBe(
      true,
    );
    expect(
      shouldScrubEmailChangeConfirmation("", "#access_token=must-not-remain"),
    ).toBe(true);
  });

  it("authenticates before validation and never requests an invalid mutation", async () => {
    const requestChange = vi.fn();
    const verifySession = vi
      .fn()
      .mockRejectedValue(new MutationError("authentication_required"));
    const state = await runAccountEmailChange(
      { email: "not-an-email", confirmed: false },
      { requestChange, verifySession },
    );

    expect(state.message).toContain("signed out");
    expect(requestChange).not.toHaveBeenCalled();
  });

  it("normalizes the new address and reports a pending verified change", async () => {
    const requestChange = vi.fn().mockResolvedValue({
      currentEmail: "current@example.test",
      userId,
    });
    const state = await runAccountEmailChange(
      { email: "  NEW.Address@Example.TEST ", confirmed: true },
      {
        requestChange,
        verifySession: vi.fn().mockResolvedValue({ userId }),
      },
    );

    expect(requestChange).toHaveBeenCalledWith("new.address@example.test");
    expect(state.status).toBe("verification_pending");
    expect(state.message).toContain("follow the links");
  });

  it("requires explicit confirmation and a genuinely different address", async () => {
    const requestChange = vi.fn().mockResolvedValue({
      currentEmail: "same@example.test",
      userId,
    });
    const dependencies = {
      requestChange,
      verifySession: vi.fn().mockResolvedValue({ userId }),
    };

    await expect(
      runAccountEmailChange(
        { email: "new@example.test", confirmed: false },
        dependencies,
      ),
    ).resolves.toMatchObject({
      status: "error",
      fieldErrors: { confirmed: expect.any(Array) },
    });
    expect(requestChange).not.toHaveBeenCalled();

    await expect(
      runAccountEmailChange(
        { email: "SAME@example.test", confirmed: true },
        dependencies,
      ),
    ).resolves.toMatchObject({
      status: "error",
      fieldErrors: { email: expect.any(Array) },
    });
  });

  it("fails closed on identity mismatch and maps safe provider errors", async () => {
    const verifySession = vi.fn().mockResolvedValue({ userId });
    await expect(
      runAccountEmailChange(
        { email: "new@example.test", confirmed: true },
        {
          verifySession,
          requestChange: vi.fn().mockResolvedValue({
            currentEmail: "old@example.test",
            userId: "10000000-0000-4000-8000-000000000002",
          }),
        },
      ),
    ).resolves.toMatchObject({ status: "error" });

    await expect(
      runAccountEmailChange(
        { email: "new@example.test", confirmed: true },
        {
          verifySession,
          requestChange: vi
            .fn()
            .mockRejectedValue(new MutationError("validation")),
        },
      ),
    ).resolves.toMatchObject({
      status: "error",
      message: expect.stringContaining("can't be used"),
    });
  });

  it("explains a recovery-session denial without calling Auth", async () => {
    const requestChange = vi.fn();
    const state = await runAccountEmailChange(
      { email: "new@example.test", confirmed: true },
      {
        requestChange,
        verifySession: vi
          .fn()
          .mockRejectedValue(new MutationError("forbidden")),
      },
    );

    expect(state).toMatchObject({
      status: "error",
      message: expect.stringContaining("during a password reset"),
    });
    expect(requestChange).not.toHaveBeenCalled();
  });
});
