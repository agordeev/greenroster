import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("../apps/web/src/lib/supabase/service-client", () => ({
  createSupabaseServiceClient: () => ({ rpc: mocks.rpc }),
}));

import { executeConfigureQuotaSettings } from "../apps/web/src/lib/groups/quota-settings-data";

const actorUserId = "10000000-0000-4000-8000-000000000001";
const input = {
  bands: [],
  expectedSettingsVersion: 1,
  historyLength: 10,
  method: "moving_average" as const,
  operationId: "30000000-0000-4000-8000-000000000001",
  participationMerit: "12.50",
  placementMerit: [
    { rank: 1, points: "10" },
    { rank: 3, points: "4.00" },
  ],
  precision: 2 as const,
  reason: "Update the Order of Merit policy",
  roundingRule: "half_away_from_zero" as const,
  standingsResetDate: null,
};

describe("quota settings RPC adapter", () => {
  it("passes merit and reset fields and normalizes the authoritative response", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: [
        {
          configured_group_id: "50000000-0000-4000-8000-000000000001",
          configured_history_length: 10,
          configured_method: "moving_average",
          configured_precision: 2,
          configured_rounding_rule: "half_away_from_zero",
          configured_participation_merit: "12.50",
          configured_placement_merit: [
            { rank: 1, points: "10.00" },
            { rank: 3, points: "4.00" },
          ],
          configured_standings_reset_date: null,
          settings_version: 2,
        },
      ],
      error: null,
    });

    await expect(
      executeConfigureQuotaSettings(
        actorUserId,
        input,
        "20000000-0000-4000-8000-000000000001",
      ),
    ).resolves.toEqual({
      groupId: "50000000-0000-4000-8000-000000000001",
      historyLength: 10,
      method: "moving_average",
      participationMerit: "12.50",
      placementMerit: [
        { rank: 1, points: "10.00" },
        { rank: 3, points: "4.00" },
      ],
      precision: 2,
      roundingRule: "half_away_from_zero",
      standingsResetDate: null,
      settingsVersion: 2,
    });
    expect(mocks.rpc).toHaveBeenCalledWith("configure_group_quota_rules", {
      p_actor_user_id: actorUserId,
      p_bands: [],
      p_correlation_id: "20000000-0000-4000-8000-000000000001",
      p_expected_settings_version: 1,
      p_method: "moving_average",
      p_moving_average_history_length: 10,
      p_operation_id: input.operationId,
      p_participation_merit: "12.50",
      p_placement_merit: input.placementMerit,
      p_precision: 2,
      p_reason: input.reason,
      p_rounding_rule: "half_away_from_zero",
      p_standings_reset_date: null,
    });
  });

  it("maps operation reuse without exposing database details", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: "23505", message: "operation_id_reused" },
    });
    await expect(
      executeConfigureQuotaSettings(
        actorUserId,
        input,
        "20000000-0000-4000-8000-000000000002",
      ),
    ).rejects.toMatchObject({ code: "operation_reused" });
  });
});
