import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../apps/mobile/src/lib/auth/mobile-supabase", () => ({
  mobileSupabase: { rpc: vi.fn() },
}));
vi.mock("../apps/mobile/src/lib/mobile-operation-id", () => ({
  createMobileOperationId: vi.fn(() => "40000000-0000-4000-8000-000000000001"),
}));

import { createMobileLiveRoundApi } from "../apps/mobile/src/lib/rounds/mobile-live-round-api";

const roundId = "10000000-0000-4000-8000-000000000001";
const groupId = "20000000-0000-4000-8000-000000000001";
const participantId = "30000000-0000-4000-8000-000000000001";
const deviceOperationId = "40000000-0000-4000-8000-000000000002";
const revisionId = "50000000-0000-4000-8000-000000000001";

const row = {
  round_id: roundId,
  group_id: groupId,
  format: "individual_net",
  scheduled_at: "2026-08-04T12:00:00.000Z",
  group_time_zone: "America/New_York",
  round_version: "4",
  participant_id: participantId,
  participant_kind: "member",
  membership_id: "60000000-0000-4000-8000-000000000001",
  sponsor_membership_id: null,
  first_name: "A",
  last_name: "Player",
  rsvp_status: "playing",
  participant_version: "2",
  quota_snapshot: "12.30",
  handicap_snapshot: null,
  tee_snapshot: "middle",
  enabled_final_total_fields: {
    golf_points: true,
    gross_score: true,
    net_score: false,
  },
  score_version: "0",
  score_revision_id: null,
  gross_score: null,
  net_score: null,
  golf_points: "0.00",
  manual_merit: null,
  plus_minus: null,
  ranking_value: null,
  score_changed_at: null,
  can_edit: true,
  can_author_manual_merit: false,
};

describe("mobile live round API", () => {
  let rpc: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    rpc = vi.fn();
  });

  it("reads through the actor-derived mobile wrapper and maps numeric values", async () => {
    rpc.mockResolvedValue({ data: [row], error: null });
    const api = createMobileLiveRoundApi({ rpc });

    await expect(api.read(roundId)).resolves.toMatchObject({
      ok: true,
      data: [
        expect.objectContaining({
          participantId,
          roundVersion: 4,
          enabledFields: {
            golfPoints: true,
            grossScore: true,
            netScore: false,
          },
          score: expect.objectContaining({ golfPoints: "0.00", version: 0 }),
        }),
      ],
    });
    expect(rpc).toHaveBeenCalledWith("read_mobile_live_round_scores", {
      p_round_id: roundId,
    });
  });

  it("rejects malformed rows and input before calling the RPC", async () => {
    const api = createMobileLiveRoundApi({ rpc });
    await expect(api.read("not-a-uuid")).resolves.toMatchObject({
      code: "validation",
      ok: false,
    });
    expect(rpc).not.toHaveBeenCalled();

    rpc.mockResolvedValue({
      data: [{ ...row, unexpected: true }],
      error: null,
    });
    await expect(api.read(roundId)).resolves.toMatchObject({
      code: "unavailable",
      ok: false,
    });
  });

  it("sends no actor or client source and preserves stale current-value details", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: {
        code: "40001",
        message: "score_version_changed",
        details: JSON.stringify({
          participant_id: participantId,
          version: 2,
          revision_id: revisionId,
          gross_score: "80",
          net_score: null,
          golf_points: "18.00",
          manual_merit: null,
          plus_minus: "5.70",
          ranking_value: "5.70",
          changed_at: "2026-08-04T12:00:01.000Z",
        }),
      },
    });
    const api = createMobileLiveRoundApi({ rpc });
    const result = await api.setScore(
      {
        participantId,
        changedFields: { golf_points: 19 },
        expectedScoreVersion: 1,
        deviceOperationId,
        clientChangedAt: "2026-08-04T12:00:00.000Z",
      },
      {
        correlationId: "70000000-0000-4000-8000-000000000001",
        operationId: "80000000-0000-4000-8000-000000000001",
      },
    );
    expect(result).toMatchObject({
      code: "stale",
      ok: false,
      details: { currentScore: { version: 2, golfPoints: "18.00" } },
    });
    expect(rpc).toHaveBeenCalledWith("set_mobile_round_participant_score", {
      p_participant_id: participantId,
      p_changed_fields: { golf_points: 19 },
      p_expected_score_version: 1,
      p_device_operation_id: deviceOperationId,
      p_client_changed_at: "2026-08-04T12:00:00.000Z",
      p_correlation_id: "70000000-0000-4000-8000-000000000001",
      p_operation_id: "80000000-0000-4000-8000-000000000001",
      p_reason: null,
    });
  });

  it("maps an authoritative receipt and permanent lock errors", async () => {
    rpc.mockResolvedValueOnce({
      data: [
        {
          participant_id: participantId,
          round_id: roundId,
          group_id: groupId,
          version: "1",
          revision_id: revisionId,
          gross_score: "80",
          net_score: null,
          golf_points: "19.00",
          manual_merit: null,
          plus_minus: "6.70",
          ranking_value: "6.70",
          changed_at: "2026-08-04T12:00:01.000Z",
        },
      ],
      error: null,
    });
    const api = createMobileLiveRoundApi({ rpc });
    await expect(
      api.setScore({
        participantId,
        changedFields: { golf_points: 19 },
        expectedScoreVersion: 0,
        deviceOperationId,
        clientChangedAt: "2026-08-04T12:00:00.000Z",
      }),
    ).resolves.toMatchObject({
      ok: true,
      data: { version: 1, golfPoints: "19.00", plusMinus: "6.70" },
    });

    rpc.mockResolvedValue({
      data: null,
      error: { code: "P0001", message: "round_scoring_locked" },
    });
    await expect(
      api.setScore({
        participantId,
        changedFields: { golf_points: 19 },
        expectedScoreVersion: 0,
        deviceOperationId,
        clientChangedAt: "2026-08-04T12:00:00.000Z",
      }),
    ).resolves.toMatchObject({ code: "locked", ok: false });
  });

  it("acknowledges a server-visible mobile synchronization receipt", async () => {
    rpc.mockResolvedValue({
      data: [
        {
          round_id: roundId,
          group_id: groupId,
          participant_id: participantId,
          score_revision_id: revisionId,
          receipt_version: "1",
          received_at: "2026-08-04T12:00:02.000Z",
        },
      ],
      error: null,
    });
    const api = createMobileLiveRoundApi({ rpc });

    await expect(
      api.acknowledgeSync(
        { participantId, scoreRevisionId: revisionId },
        {
          correlationId: "70000000-0000-4000-8000-000000000002",
          operationId: "80000000-0000-4000-8000-000000000002",
        },
      ),
    ).resolves.toMatchObject({
      ok: true,
      data: {
        roundId,
        groupId,
        participantId,
        scoreRevisionId: revisionId,
        receiptVersion: 1,
      },
    });
    expect(rpc).toHaveBeenCalledWith("acknowledge_mobile_round_score_sync", {
      p_participant_id: participantId,
      p_score_revision_id: revisionId,
      p_correlation_id: "70000000-0000-4000-8000-000000000002",
      p_operation_id: "80000000-0000-4000-8000-000000000002",
    });
  });

  it("rejects an invalid synchronization receipt before calling the RPC", async () => {
    const api = createMobileLiveRoundApi({ rpc });
    await expect(
      api.acknowledgeSync({ participantId, scoreRevisionId: "not-a-uuid" }),
    ).resolves.toMatchObject({ code: "validation", ok: false });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("treats a missing or revoked live round as definitive access loss", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: "P0002", message: "round_not_found" },
    });
    const api = createMobileLiveRoundApi({ rpc });
    await expect(api.read(roundId)).resolves.toMatchObject({
      code: "permission_denied",
      ok: false,
    });
  });
});
