import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../apps/mobile/src/lib/auth/mobile-supabase", () => ({
  mobileSupabase: { rpc: vi.fn() },
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
});
