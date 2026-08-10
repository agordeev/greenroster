import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("../apps/web/src/lib/supabase/service-client", () => ({
  createSupabaseServiceClient: () => ({ rpc: mocks.rpc }),
}));

import { executeSetRoundParticipantHoleScore } from "../apps/web/src/lib/rounds/round-hole-scorecard-data";

describe("hole scorecard RPC adapter", () => {
  it("sends the portal source and maps the authoritative receipt", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: [
        {
          participant_id: "d5000000-0000-4000-8000-000000000001",
          round_id: "d4000000-0000-4000-8000-000000000001",
          group_id: "d2000000-0000-4000-8000-000000000001",
          hole_number: 1,
          version: "1",
          revision_id: "d9000000-0000-4000-8000-000000000001",
          strokes: 4,
          putts: 2,
          fairway_hit: true,
          green_in_regulation: false,
          sand_save: null,
          hole_comment: "Good start",
          updated_at: "2026-08-10T00:00:00.000Z",
        },
      ],
      error: null,
    });
    const input = {
      participantId: "d5000000-0000-4000-8000-000000000001",
      holeNumber: 1,
      changedFields: { strokes: 4 },
      expectedVersion: 0,
      deviceOperationId: "d6000000-0000-4000-8000-000000000001",
      clientChangedAt: "2026-08-10T00:00:00.000Z",
      operationId: "d8000000-0000-4000-8000-000000000001",
    } as const;
    await expect(
      executeSetRoundParticipantHoleScore(
        "d1000000-0000-4000-8000-000000000001",
        input,
        "d7000000-0000-4000-8000-000000000001",
      ),
    ).resolves.toMatchObject({
      participantId: input.participantId,
      holeNumber: 1,
      version: 1,
      strokes: 4,
    });
    expect(mocks.rpc).toHaveBeenCalledWith(
      "set_round_participant_hole_score",
      expect.objectContaining({
        p_source: "portal",
        p_hole_number: 1,
        p_expected_version: 0,
      }),
    );
  });
});
