import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
}));

vi.mock("../apps/web/src/lib/supabase/service-client", () => ({
  createSupabaseServiceClient: () => ({ rpc: mocks.rpc }),
}));

import { executeReadNotificationDeliveryHealth } from "../apps/web/src/lib/notifications/notification-health-data";

const actorUserId = "10000000-0000-4000-8000-000000000001";
const groupId = "20000000-0000-4000-8000-000000000001";

describe("notification delivery health RPC adapter", () => {
  it("accepts aggregate counts returned as bigint strings and exposes no recipient data", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: [
        {
          group_id: groupId,
          outbox_queued: "2",
          outbox_processing: 1,
          outbox_retryable: "3",
          outbox_oldest_at: "2026-08-04T10:00:00.000Z",
          email_queued: "4",
          email_sending: 1,
          email_retryable: 2,
          email_failed_permanent: "5",
          email_suppressed: 6,
          email_attempted: "8",
          email_bounced: 1,
          email_complained: "2",
          email_bounce_rate: "0.125",
          email_complaint_rate: 0.25,
          push_queued: 7,
          push_sending: "8",
          push_retryable: 9,
          push_failed_permanent: "10",
          push_cancelled: 11,
          push_invalid_token: "3",
          push_invalid_token_rate: "0.3",
          push_receipt_pending: "12",
          push_receipt_failed: 13,
          last_activity_at: "2026-08-04T11:00:00.000Z",
          sampled_at: "2026-08-04T12:00:00.000Z",
        },
      ],
      error: null,
    });

    await expect(
      executeReadNotificationDeliveryHealth(actorUserId),
    ).resolves.toEqual({
      groupId,
      outboxQueued: 2,
      outboxProcessing: 1,
      outboxRetryable: 3,
      outboxOldestAt: "2026-08-04T10:00:00.000Z",
      emailQueued: 4,
      emailSending: 1,
      emailRetryable: 2,
      emailFailedPermanent: 5,
      emailSuppressed: 6,
      emailAttempted: 8,
      emailBounced: 1,
      emailComplained: 2,
      emailBounceRate: 0.125,
      emailComplaintRate: 0.25,
      pushQueued: 7,
      pushSending: 8,
      pushRetryable: 9,
      pushFailedPermanent: 10,
      pushCancelled: 11,
      pushInvalidToken: 3,
      pushInvalidTokenRate: 0.3,
      pushReceiptPending: 12,
      pushReceiptFailed: 13,
      lastActivityAt: "2026-08-04T11:00:00.000Z",
      sampledAt: "2026-08-04T12:00:00.000Z",
    });
    expect(mocks.rpc).toHaveBeenCalledWith(
      "read_notification_delivery_health",
      {
        p_actor_user_id: actorUserId,
      },
    );
  });

  it("maps tenant denial and rejects malformed aggregate rows", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: "P0003", message: "notification_health_not_available" },
    });
    await expect(
      executeReadNotificationDeliveryHealth(actorUserId),
    ).rejects.toMatchObject({
      code: "forbidden",
    });

    mocks.rpc.mockResolvedValueOnce({
      data: [{ group_id: groupId }],
      error: null,
    });
    await expect(
      executeReadNotificationDeliveryHealth(actorUserId),
    ).rejects.toMatchObject({
      code: "unexpected",
    });
  });
});
