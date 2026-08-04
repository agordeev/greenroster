import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("../apps/web/src/lib/supabase/service-client", () => ({
  createSupabaseServiceClient: () => ({ rpc: mocks.rpc }),
}));

import {
  executeReadRoundParticipants,
  executeSetRoundRsvp,
} from "../apps/web/src/lib/rounds/round-rsvp-data";

const roundId = "60000000-0000-4000-8000-000000000001";
const groupId = "50000000-0000-4000-8000-000000000001";
const input = {
  roundId,
  rsvpStatus: "playing" as const,
  expectedParticipantVersion: 1,
  source: "member_web" as const,
  operationId: "70000000-0000-4000-8000-000000000001",
};

describe("round RSVP RPC adapter", () => {
  it("reads the participant version needed for the next optimistic RSVP", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: [
        {
          round_id: roundId,
          participant_id: "80000000-0000-4000-8000-000000000001",
          group_id: groupId,
          participant_kind: "member",
          membership_id: "40000000-0000-4000-8000-000000000001",
          sponsor_membership_id: null,
          first_name: "Member",
          last_name: "Ready",
          rsvp_status: "playing",
          version: "2",
          quota_snapshot: 12.5,
          quota_snapshot_source: null,
          handicap_snapshot: 9.2,
          handicap_snapshot_source: null,
          handicap_snapshot_as_of: null,
          tee_snapshot: null,
        },
      ],
      error: null,
    });

    await expect(
      executeReadRoundParticipants(
        "10000000-0000-4000-8000-000000000001",
        roundId,
      ),
    ).resolves.toMatchObject([
      {
        roundId,
        participantId: "80000000-0000-4000-8000-000000000001",
        version: 2,
        quotaSnapshot: "12.5",
        handicapSnapshot: "9.2",
      },
    ]);
    expect(mocks.rpc).toHaveBeenCalledWith("read_round_participants", {
      p_actor_user_id: "10000000-0000-4000-8000-000000000001",
      p_round_id: roundId,
    });
  });

  it("passes source and expected participant version", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: [
        {
          round_id: roundId,
          group_id: groupId,
          participant_id: "80000000-0000-4000-8000-000000000001",
          membership_id: "40000000-0000-4000-8000-000000000001",
          rsvp_status: "playing",
          version: "2",
          changed_at: "2026-08-03T12:00:00.000Z",
        },
      ],
      error: null,
    });

    await expect(
      executeSetRoundRsvp(
        "10000000-0000-4000-8000-000000000001",
        input,
        "20000000-0000-4000-8000-000000000001",
      ),
    ).resolves.toMatchObject({
      roundId,
      groupId,
      rsvpStatus: "playing",
      version: 2,
    });
    expect(mocks.rpc).toHaveBeenCalledWith("set_round_participant_rsvp", {
      p_actor_user_id: "10000000-0000-4000-8000-000000000001",
      p_round_id: roundId,
      p_rsvp_status: "playing",
      p_expected_participant_version: 1,
      p_source: "member_web",
      p_correlation_id: "20000000-0000-4000-8000-000000000001",
      p_operation_id: input.operationId,
    });
  });

  it("normalizes PostgreSQL numeric snapshot values from numbers or strings", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: [
        {
          round_id: roundId,
          participant_id: "80000000-0000-4000-8000-000000000002",
          group_id: groupId,
          participant_kind: "member",
          membership_id: "40000000-0000-4000-8000-000000000002",
          sponsor_membership_id: null,
          first_name: "Member",
          last_name: "Numeric",
          rsvp_status: "no_response",
          version: 1,
          quota_snapshot: "13.4",
          quota_snapshot_source: { method: "moving_average" },
          handicap_snapshot: 8.7,
          handicap_snapshot_source: "manual",
          handicap_snapshot_as_of: "2026-08-02",
          tee_snapshot: "middle",
        },
      ],
      error: null,
    });

    await expect(
      executeReadRoundParticipants(
        "10000000-0000-4000-8000-000000000001",
        roundId,
      ),
    ).resolves.toMatchObject([
      {
        quotaSnapshot: "13.4",
        handicapSnapshot: "8.7",
      },
    ]);
  });

  it("accepts a sponsored guest row without inventing a membership id", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: [
        {
          round_id: roundId,
          participant_id: "80000000-0000-4000-8000-000000000003",
          group_id: groupId,
          participant_kind: "guest",
          membership_id: null,
          sponsor_membership_id: "40000000-0000-4000-8000-000000000003",
          first_name: "Sponsored",
          last_name: "Guest",
          rsvp_status: "playing",
          version: 1,
          quota_snapshot: null,
          quota_snapshot_source: null,
          handicap_snapshot: null,
          handicap_snapshot_source: null,
          handicap_snapshot_as_of: null,
          tee_snapshot: null,
        },
      ],
      error: null,
    });

    await expect(
      executeReadRoundParticipants(
        "10000000-0000-4000-8000-000000000001",
        roundId,
      ),
    ).resolves.toMatchObject([
      {
        participantKind: "guest",
        membershipId: null,
        sponsorMembershipId: "40000000-0000-4000-8000-000000000003",
        firstName: "Sponsored",
        lastName: "Guest",
      },
    ]);
  });

  it.each([
    ["round_rsvp_closed", "locked"],
    ["participant_version_changed", "stale_version"],
    ["rsvp_source_invalid", "validation"],
  ])("maps %s to %s", async (message, code) => {
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: {
        code:
          message === "round_rsvp_closed"
            ? "P0001"
            : message === "participant_version_changed"
              ? "40001"
              : "22023",
        message,
      },
    });
    await expect(
      executeSetRoundRsvp(
        "10000000-0000-4000-8000-000000000001",
        input,
        "20000000-0000-4000-8000-000000000002",
      ),
    ).rejects.toMatchObject({ code });
  });
});
