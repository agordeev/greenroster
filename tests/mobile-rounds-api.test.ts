import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../apps/mobile/src/lib/auth/mobile-supabase", () => ({
  mobileSupabase: { rpc: vi.fn() },
}));
vi.mock("../apps/mobile/src/lib/mobile-operation-id", () => ({
  createMobileOperationId: vi.fn(() => "40000000-0000-4000-8000-000000000001"),
}));

import { createMobileRoundsApi } from "../apps/mobile/src/lib/rounds/mobile-rounds-api";

const roundId = "10000000-0000-4000-8000-000000000001";
const groupId = "20000000-0000-4000-8000-000000000001";

const row = {
  round_id: roundId,
  group_id: groupId,
  description: "Saturday live round",
  scheduled_at: "2026-08-08T12:00:00.000Z",
  group_time_zone: "America/New_York",
  venue: "North Course",
  format: "individual_net",
  state: "live",
  version: "4",
  participant_status: "playing",
  participant_version: "2",
  participant_count: "3",
  playing_count: "2",
  updated_at: "2026-08-04T12:00:00.000Z",
};

const detailRow = {
  ...row,
  state: "published",
  round_url: "https://greenroster.example/rounds/saturday",
  notes: "Bring carts by 8:30.",
  rsvp_deadline_at: "2026-08-08T10:00:00.000Z",
  rsvp_changed_at: "2026-08-04T12:01:00.000Z",
  cancelled_at: null,
  cancellation_reason: null,
};

describe("mobile rounds API", () => {
  let rpc: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    rpc = vi.fn();
  });

  it("maps actor-derived round summaries and sends the stable completed cursor", async () => {
    rpc.mockResolvedValue({ data: [row], error: null });
    const api = createMobileRoundsApi({ rpc });

    await expect(
      api.list({
        completedBefore: "2026-08-01T00:00:00.000Z",
        completedLimit: 10,
      }),
    ).resolves.toEqual({
      data: [
        {
          roundId,
          groupId,
          description: "Saturday live round",
          scheduledAt: "2026-08-08T12:00:00.000Z",
          groupTimeZone: "America/New_York",
          venue: "North Course",
          format: "individual_net",
          state: "live",
          version: 4,
          participantStatus: "playing",
          participantVersion: 2,
          participantCount: 3,
          playingCount: 2,
          updatedAt: "2026-08-04T12:00:00.000Z",
        },
      ],
      ok: true,
    });
    expect(rpc).toHaveBeenCalledWith("list_mobile_rounds", {
      p_completed_before: "2026-08-01T00:00:00.000Z",
      p_completed_limit: 10,
    });
  });

  it("rejects malformed responses and invalid queries before the RPC", async () => {
    const api = createMobileRoundsApi({ rpc });
    await expect(api.list({ completedLimit: 0 })).resolves.toMatchObject({
      code: "validation",
      ok: false,
    });
    expect(rpc).not.toHaveBeenCalled();

    rpc.mockResolvedValue({
      data: [{ ...row, unexpected: true }],
      error: null,
    });
    await expect(api.list()).resolves.toMatchObject({
      code: "unavailable",
      ok: false,
    });
  });

  it("maps permission and transport failures to safe states", async () => {
    rpc.mockResolvedValueOnce({
      data: null,
      error: { code: "P0003", message: "actor_not_authorized" },
    });
    rpc.mockRejectedValueOnce(new Error("offline"));
    const api = createMobileRoundsApi({ rpc });

    await expect(api.list()).resolves.toMatchObject({
      code: "permission_denied",
      ok: false,
    });
    await expect(api.list()).resolves.toMatchObject({
      code: "unavailable",
      ok: false,
    });
  });

  it("resolves an exact historical round summary for deep links", async () => {
    rpc.mockResolvedValue({ data: [row], error: null });
    const api = createMobileRoundsApi({ rpc });

    await expect(api.read(roundId)).resolves.toEqual({
      data: {
        roundId,
        groupId,
        description: "Saturday live round",
        scheduledAt: "2026-08-08T12:00:00.000Z",
        groupTimeZone: "America/New_York",
        venue: "North Course",
        format: "individual_net",
        state: "live",
        version: 4,
        participantStatus: "playing",
        participantVersion: 2,
        participantCount: 3,
        playingCount: 2,
        updatedAt: "2026-08-04T12:00:00.000Z",
      },
      ok: true,
    });
    expect(rpc).toHaveBeenCalledWith("read_mobile_round_summary", {
      p_round_id: roundId,
    });
  });

  it("does not accept malformed exact-summary responses or IDs", async () => {
    const api = createMobileRoundsApi({ rpc });
    await expect(api.read("not-a-uuid")).resolves.toMatchObject({
      code: "validation",
      ok: false,
    });
    expect(rpc).not.toHaveBeenCalled();

    rpc.mockResolvedValue({ data: [], error: null });
    await expect(api.read(roundId)).resolves.toMatchObject({
      code: "unavailable",
      ok: false,
    });
  });

  it("reads strict upcoming detail with player-visible notes and RSVP timing", async () => {
    rpc.mockResolvedValue({ data: [detailRow], error: null });
    const api = createMobileRoundsApi({ rpc });

    await expect(api.readDetail(roundId)).resolves.toMatchObject({
      ok: true,
      data: {
        roundId,
        state: "published",
        roundUrl: "https://greenroster.example/rounds/saturday",
        notes: "Bring carts by 8:30.",
        rsvpDeadlineAt: "2026-08-08T10:00:00.000Z",
        rsvpChangedAt: "2026-08-04T12:01:00.000Z",
      },
    });
    expect(rpc).toHaveBeenCalledWith("read_mobile_round_detail", {
      p_round_id: roundId,
    });
  });

  it("sends an actor-derived RSVP with versions and operation context", async () => {
    rpc.mockResolvedValue({
      data: [
        {
          round_id: roundId,
          group_id: groupId,
          participant_id: "30000000-0000-4000-8000-000000000001",
          membership_id: "60000000-0000-4000-8000-000000000001",
          rsvp_status: "playing",
          version: "3",
          changed_at: "2026-08-04T12:02:00.000Z",
        },
      ],
      error: null,
    });
    const api = createMobileRoundsApi({ rpc });

    await expect(
      api.setRsvp(
        {
          roundId,
          rsvpStatus: "playing",
          expectedParticipantVersion: 2,
        },
        {
          correlationId: "70000000-0000-4000-8000-000000000001",
          operationId: "80000000-0000-4000-8000-000000000001",
        },
      ),
    ).resolves.toMatchObject({
      ok: true,
      data: {
        roundId,
        rsvpStatus: "playing",
        version: 3,
      },
    });
    expect(rpc).toHaveBeenCalledWith("set_mobile_round_participant_rsvp", {
      p_round_id: roundId,
      p_rsvp_status: "playing",
      p_expected_participant_version: 2,
      p_correlation_id: "70000000-0000-4000-8000-000000000001",
      p_operation_id: "80000000-0000-4000-8000-000000000001",
    });
  });

  it("rolls RSVP failures into safe stale, closed, and transport states", async () => {
    rpc.mockResolvedValueOnce({
      data: null,
      error: { code: "40001", message: "participant_version_changed" },
    });
    rpc.mockResolvedValueOnce({
      data: null,
      error: { code: "P0001", message: "round_rsvp_closed" },
    });
    rpc.mockRejectedValueOnce(new Error("offline"));
    const api = createMobileRoundsApi({ rpc });
    const input = {
      roundId,
      rsvpStatus: "not_playing" as const,
      expectedParticipantVersion: 2,
    };

    await expect(api.setRsvp(input)).resolves.toMatchObject({
      code: "stale",
      ok: false,
    });
    await expect(api.setRsvp(input)).resolves.toMatchObject({
      code: "locked",
      ok: false,
    });
    await expect(api.setRsvp(input)).resolves.toMatchObject({
      code: "unavailable",
      ok: false,
    });
  });
});
