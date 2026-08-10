import { describe, expect, it, vi } from "vitest";

import {
  roundAnnouncementInputSchema,
  runRoundAnnouncementMutation,
} from "../apps/web/src/domain/round-announcement";

const actorUserId = "10000000-0000-4000-8000-000000000001";
const roundId = "20000000-0000-4000-8000-000000000001";
const operationId = "30000000-0000-4000-8000-000000000001";
const correlationId = "40000000-0000-4000-8000-000000000001";

describe("round announcement mutation boundary", () => {
  it("validates the short plain-text payload before execution", async () => {
    const execute = vi.fn();
    const result = await runRoundAnnouncementMutation(
      {
        body: "x".repeat(301),
        operationId,
        roundId,
      },
      correlationId,
      {
        execute,
        verifySession: vi.fn().mockResolvedValue({ userId: actorUserId }),
      },
    );

    expect(result).toMatchObject({ ok: false, error: { code: "validation" } });
    expect(execute).not.toHaveBeenCalled();
  });

  it("passes the verified actor and correlation context to the RPC adapter", async () => {
    const receipt = {
      announcementId: "50000000-0000-4000-8000-000000000001",
      authorDisplayName: "Alex Golfer",
      authorRole: "coordinator" as const,
      body: "Meet by the first tee.",
      createdAt: "2026-08-10T12:00:00.000Z",
      groupId: "60000000-0000-4000-8000-000000000001",
      inboxCount: 3,
      outboxJobId: "70000000-0000-4000-8000-000000000001",
      roundId,
    };
    const execute = vi.fn().mockResolvedValue(receipt);
    await expect(
      runRoundAnnouncementMutation(
        { body: receipt.body, operationId, roundId },
        correlationId,
        {
          execute,
          verifySession: vi.fn().mockResolvedValue({ userId: actorUserId }),
        },
      ),
    ).resolves.toMatchObject({ ok: true, data: receipt });
    expect(execute).toHaveBeenCalledWith(
      actorUserId,
      { body: receipt.body, operationId, roundId },
      expect.any(String),
    );
  });

  it("keeps the input schema closed", () => {
    expect(
      roundAnnouncementInputSchema.safeParse({
        body: "An update",
        operationId,
        roundId,
        unexpected: true,
      }).success,
    ).toBe(false);
  });
});
