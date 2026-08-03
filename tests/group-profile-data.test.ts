import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
}));

vi.mock("../apps/web/src/lib/supabase/service-client", () => ({
  createSupabaseServiceClient: () => ({ rpc: mocks.rpc }),
}));

import { executeUpdateGroupProfile } from "../apps/web/src/lib/groups/group-profile-data";

const input = {
  expectedGroupVersion: 1,
  groupName: "Green Hills",
  groupTimeZone: "UTC",
  operationId: "30000000-0000-4000-8000-000000000001",
  reason: "Correct the club profile",
};

describe("group profile RPC adapter", () => {
  it.each([
    ["group_profile_name_required", "groupName"],
    ["group_profile_time_zone_required", "groupTimeZone"],
    ["group_profile_time_zone_invalid", "groupTimeZone"],
    ["group_profile_reason_required", "reason"],
    ["group_profile_reason_invalid", "reason"],
    ["group_profile_input_invalid", "expectedGroupVersion"],
  ])("maps %s to the %s field", async (message, field) => {
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: "22023", message },
    });

    await expect(
      executeUpdateGroupProfile(
        "10000000-0000-4000-8000-000000000001",
        input,
        "20000000-0000-4000-8000-000000000001",
      ),
    ).rejects.toMatchObject({
      code: "validation",
      fieldErrors: { [field]: expect.any(Array) },
    });
  });

  it("preserves the safe stale-version class from the RPC", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: "40001", message: "group_version_changed" },
    });

    await expect(
      executeUpdateGroupProfile(
        "10000000-0000-4000-8000-000000000001",
        input,
        "20000000-0000-4000-8000-000000000001",
      ),
    ).rejects.toMatchObject({ code: "stale_version" });
  });
});
