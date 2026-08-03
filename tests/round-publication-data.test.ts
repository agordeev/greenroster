import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("../apps/web/src/lib/supabase/service-client", () => ({
  createSupabaseServiceClient: () => ({ rpc: mocks.rpc }),
}));

import {
  executePreviewRoundPublication,
  executePublishRound,
} from "../apps/web/src/lib/rounds/round-publication-data";

const memberRow = {
  round_id: "60000000-0000-4000-8000-000000000001",
  format: "individual_net" as const,
  review_version: 1,
  review_fingerprint:
    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  membership_id: "40000000-0000-4000-8000-000000000001",
  group_id: "50000000-0000-4000-8000-000000000001",
  first_name: "Ada",
  last_name: "Lovelace",
  eligibility_state: "eligible" as const,
  ineligibility_reason: null,
  included: true,
  projection_ready: true,
  projected_quota: "12.5",
  quota_snapshot_source: { method: "moving_average" },
  handicap_snapshot: "9.2",
  handicap_snapshot_source: "manual" as const,
  handicap_snapshot_as_of: "2026-08-01",
  tee_snapshot: "middle" as const,
  email_ready: true,
};

describe("round publication RPC adapters", () => {
  it("passes actor and reviewed exclusions to preview", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: [memberRow], error: null });
    await expect(
      executePreviewRoundPublication("10000000-0000-4000-8000-000000000001", {
        roundId: "60000000-0000-4000-8000-000000000001",
        excludedMembershipIds: [memberRow.membership_id],
      }),
    ).resolves.toMatchObject({
      members: [
        expect.objectContaining({ membershipId: memberRow.membership_id }),
      ],
    });
    expect(mocks.rpc).toHaveBeenCalledWith("preview_round_publication", {
      p_actor_user_id: "10000000-0000-4000-8000-000000000001",
      p_round_id: "60000000-0000-4000-8000-000000000001",
      p_excluded_membership_ids: [memberRow.membership_id],
    });
  });

  it("maps a publish receipt and server readiness errors safely", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: [
        {
          round_id: "60000000-0000-4000-8000-000000000001",
          group_id: "50000000-0000-4000-8000-000000000001",
          state: "published",
          version: "2",
          published_at: "2026-08-03T12:00:00.000Z",
          participant_count: 1,
          notification_count: 1,
        },
      ],
      error: null,
    });
    await expect(
      executePublishRound(
        "10000000-0000-4000-8000-000000000001",
        {
          roundId: "60000000-0000-4000-8000-000000000001",
          excludedMembershipIds: [],
          operationId: "70000000-0000-4000-8000-000000000001",
          expectedRoundVersion: 1,
          reviewFingerprint: memberRow.review_fingerprint,
        },
        "20000000-0000-4000-8000-000000000001",
      ),
    ).resolves.toMatchObject({ state: "published", version: 2 });
    expect(mocks.rpc).toHaveBeenCalledWith("publish_round", {
      p_actor_user_id: "10000000-0000-4000-8000-000000000001",
      p_round_id: "60000000-0000-4000-8000-000000000001",
      p_excluded_membership_ids: [],
      p_correlation_id: "20000000-0000-4000-8000-000000000001",
      p_operation_id: "70000000-0000-4000-8000-000000000001",
      p_expected_round_version: 1,
      p_review_fingerprint: memberRow.review_fingerprint,
    });

    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: "22023", message: "publication_quota_not_ready" },
    });
    await expect(
      executePublishRound(
        "10000000-0000-4000-8000-000000000001",
        {
          roundId: "60000000-0000-4000-8000-000000000001",
          excludedMembershipIds: [],
          operationId: "70000000-0000-4000-8000-000000000002",
          expectedRoundVersion: 1,
          reviewFingerprint: memberRow.review_fingerprint,
        },
        "20000000-0000-4000-8000-000000000002",
      ),
    ).rejects.toMatchObject({
      code: "validation",
      fieldErrors: { roundId: expect.any(Array) },
    });
  });

  it.each([
    ["round_not_found", "unavailable"],
    ["round_state_locked", "locked"],
    ["publication_participant_ineligible", "validation"],
    ["publication_quota_settings_missing", "validation"],
    ["publication_quota_not_ready", "validation"],
  ])("maps %s to %s", async (message, code) => {
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: {
        code:
          message === "round_not_found"
            ? "P0002"
            : message === "round_state_locked"
              ? "P0001"
              : "22023",
        message,
      },
    });
    await expect(
      executePublishRound(
        "10000000-0000-4000-8000-000000000001",
        {
          roundId: "60000000-0000-4000-8000-000000000001",
          excludedMembershipIds: [],
          operationId: "70000000-0000-4000-8000-000000000003",
          expectedRoundVersion: 1,
          reviewFingerprint: memberRow.review_fingerprint,
        },
        "20000000-0000-4000-8000-000000000003",
      ),
    ).rejects.toMatchObject({ code });
  });
});
