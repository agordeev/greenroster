import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("../apps/web/src/lib/supabase/service-client", () => ({
  createSupabaseServiceClient: () => ({ rpc: mocks.rpc }),
}));

import {
  executeCreateRoundDraft,
  executeListRoundDrafts,
  executeUpdateRoundDraft,
} from "../apps/web/src/lib/rounds/round-drafts-data";

const row = {
  round_id: "40000000-0000-4000-8000-000000000001",
  group_id: "50000000-0000-4000-8000-000000000001",
  group_name: "Round Group",
  group_time_zone: "America/New_York",
  description: "August round",
  scheduled_at: "2026-08-15T13:30:00.000Z",
  venue: "North Course",
  round_url: "https://example.com/round",
  notes: "Bring a cart.",
  notes_visible_to_players: true,
  rsvp_deadline_at: "2026-08-14T13:30:00.000Z",
  format: "individual_net" as const,
  enable_gross_score: true,
  enable_net_score: true,
  state: "draft" as const,
  version: 2,
  created_at: "2026-08-03T00:00:00.000Z",
  updated_at: "2026-08-03T00:00:00.000Z",
};

const input = {
  description: "August round",
  scheduledLocal: "2026-08-15T09:30",
  venue: "North Course",
  roundUrl: "https://example.com/round",
  notes: "Bring a cart.",
  notesVisibleToPlayers: true,
  rsvpDeadlineLocal: "2026-08-14T09:30",
  format: "individual_net" as const,
  operationId: "30000000-0000-4000-8000-000000000001",
};

describe("round draft Supabase adapters", () => {
  it("sends the verified actor and exact local draft fields to create", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: [row], error: null });

    await expect(
      executeCreateRoundDraft(
        "10000000-0000-4000-8000-000000000001",
        input,
        "20000000-0000-4000-8000-000000000001",
      ),
    ).resolves.toMatchObject({ roundId: row.round_id, version: 2 });

    expect(mocks.rpc).toHaveBeenCalledWith("create_round_draft", {
      p_actor_user_id: "10000000-0000-4000-8000-000000000001",
      p_description: "August round",
      p_scheduled_local: "2026-08-15T09:30",
      p_venue: "North Course",
      p_round_url: "https://example.com/round",
      p_notes: "Bring a cart.",
      p_notes_visible_to_players: true,
      p_rsvp_deadline_local: "2026-08-14T09:30",
      p_format: "individual_net",
      p_correlation_id: "20000000-0000-4000-8000-000000000001",
      p_operation_id: input.operationId,
    });
  });

  it("maps list projections without exposing unvalidated rows", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: [row], error: null });

    await expect(
      executeListRoundDrafts("10000000-0000-4000-8000-000000000001"),
    ).resolves.toEqual([
      expect.objectContaining({
        roundId: row.round_id,
        groupName: "Round Group",
        groupTimeZone: "America/New_York",
        format: "individual_net",
        enableGrossScore: true,
        enableNetScore: true,
      }),
    ]);
    expect(mocks.rpc).toHaveBeenCalledWith("list_rounds", {
      p_actor_user_id: "10000000-0000-4000-8000-000000000001",
    });
  });

  it("maps server validation and stale-version errors to safe mutation classes", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: "22023", message: "round_scheduled_at_invalid" },
    });
    await expect(
      executeCreateRoundDraft(
        "10000000-0000-4000-8000-000000000001",
        input,
        "20000000-0000-4000-8000-000000000001",
      ),
    ).rejects.toMatchObject({
      code: "validation",
      fieldErrors: { scheduledLocal: expect.any(Array) },
    });

    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: "40001", message: "round_version_changed" },
    });
    await expect(
      executeUpdateRoundDraft(
        "10000000-0000-4000-8000-000000000001",
        { ...input, roundId: row.round_id, expectedRoundVersion: 1 },
        "20000000-0000-4000-8000-000000000002",
      ),
    ).rejects.toMatchObject({ code: "stale_version" });
  });
});
