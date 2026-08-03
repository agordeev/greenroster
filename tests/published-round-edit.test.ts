import { describe, expect, it, vi } from "vitest";

import {
  previewPublishedRoundEditInputSchema,
  runPreviewPublishedRoundEdit,
  runUpdatePublishedRoundEdit,
  updatePublishedRoundEditInputSchema,
} from "../apps/web/src/domain/published-round-edit";
import { MutationError } from "../apps/web/src/lib/mutations/result";

const session = {
  userId: "10000000-0000-4000-8000-000000000001",
  emailConfirmedAt: "2026-08-03T00:00:00.000Z",
};

const input = {
  roundId: "40000000-0000-4000-8000-000000000001",
  description: "Updated August round",
  scheduledLocal: "2026-08-15T09:30",
  venue: "North Course",
  roundUrl: "https://example.com/round",
  notes: "Bring a cart.",
  notesVisibleToPlayers: true,
  rsvpDeadlineLocal: "2026-08-14T09:30",
  expectedRoundVersion: 2,
};

describe("published round edit domain boundary", () => {
  it("validates local time, HTTPS URL, version, and apply fingerprint", () => {
    expect(previewPublishedRoundEditInputSchema.safeParse(input).success).toBe(
      true,
    );
    expect(
      previewPublishedRoundEditInputSchema.safeParse({
        ...input,
        scheduledLocal: "2026-02-30T09:30",
      }).success,
    ).toBe(false);
    expect(
      previewPublishedRoundEditInputSchema.safeParse({
        ...input,
        roundUrl: "http://example.com",
      }).success,
    ).toBe(false);
    expect(
      updatePublishedRoundEditInputSchema.safeParse({
        ...input,
        impactFingerprint: "a".repeat(64),
        announce: false,
        operationId: "80000000-0000-4000-8000-000000000001",
      }).success,
    ).toBe(true);
  });

  it("authenticates before preview execution", async () => {
    const execute = vi.fn();
    const result = await runPreviewPublishedRoundEdit(input, null, {
      execute,
      verifySession: vi
        .fn()
        .mockRejectedValue(new MutationError("authentication_required")),
    });
    expect(result.ok).toBe(false);
    expect(result.ok ? null : result.error.code).toBe(
      "authentication_required",
    );
    expect(execute).not.toHaveBeenCalled();
  });

  it("passes the verified actor to preview and apply", async () => {
    const preview = { impact: true };
    const previewExecute = vi.fn().mockResolvedValue(preview);
    await expect(
      runPreviewPublishedRoundEdit(input, null, {
        execute: previewExecute,
        verifySession: vi.fn().mockResolvedValue(session),
      }),
    ).resolves.toMatchObject({ ok: true, data: preview });
    expect(previewExecute).toHaveBeenCalledWith(session.userId, input);

    const applyInput = {
      ...input,
      impactFingerprint: "a".repeat(64),
      announce: true,
      operationId: "80000000-0000-4000-8000-000000000001",
    };
    const receipt = { version: 3 };
    const applyExecute = vi.fn().mockResolvedValue(receipt);
    await expect(
      runUpdatePublishedRoundEdit(applyInput, null, {
        execute: applyExecute,
        verifySession: vi.fn().mockResolvedValue(session),
      }),
    ).resolves.toMatchObject({ ok: true, data: receipt });
    expect(applyExecute).toHaveBeenCalledWith(
      session.userId,
      applyInput,
      expect.any(String),
    );
  });

  it("preserves stale apply failures", async () => {
    const result = await runUpdatePublishedRoundEdit(
      {
        ...input,
        impactFingerprint: "a".repeat(64),
        announce: false,
        operationId: "80000000-0000-4000-8000-000000000001",
      },
      null,
      {
        execute: vi.fn().mockRejectedValue(new MutationError("stale_version")),
        verifySession: vi.fn().mockResolvedValue(session),
      },
    );
    expect(result.ok).toBe(false);
    expect(result.ok ? null : result.error.code).toBe("stale_version");
  });
});
