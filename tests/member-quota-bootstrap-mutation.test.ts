import { describe, expect, it, vi } from "vitest";

import {
  runMemberQuotaBootstrapMutation,
  type MemberQuotaBootstrapResult,
} from "../apps/web/src/lib/memberships/member-quota-bootstrap";
import { executeGetMemberQuotaBootstrapContext } from "../apps/web/src/lib/memberships/member-quota-bootstrap-data";
import { MutationError } from "../apps/web/src/lib/mutations/result";

const session = {
  userId: "10000000-0000-4000-8000-000000000001",
  emailConfirmedAt: "2026-07-26T00:00:00.000Z",
};

const input = {
  confirmed: true as const,
  expectedProjectionVersion: 0,
  expectedSettingsVersion: 2,
  initialQuota: "18.5",
  membershipId: "60000000-0000-4000-8000-000000000001",
  operationId: "30000000-0000-4000-8000-000000000001",
  reason: "  Seed this member's quota  ",
  seedTotals: ["20", "30", "40"],
  useInitialQuota: null,
};

const result: MemberQuotaBootstrapResult = {
  groupId: "50000000-0000-4000-8000-000000000001",
  membershipId: input.membershipId,
  projectionReady: true,
  projectedQuota: "18.5",
  projectionSource: {
    kind: "initial_quota",
    precision: 1,
    seed_positions: [],
    settings_version: 2,
  },
  projectionVersion: 1,
  settingsVersion: 2,
  usesInitialQuota: true,
};

describe("member quota bootstrap mutation boundary", () => {
  it("parses the administrator detail context with ordered calculation-only seeds", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [
        {
          adjustment_bands: [],
          context_group_id: "50000000-0000-4000-8000-000000000001",
          context_membership_id: input.membershipId,
          initial_quota: "18.50",
          initial_quota_provenance: "administrator_override",
          projection_ready: true,
          projection_effective_at: "2026-07-27T09:00:00.000Z",
          projection_source: { kind: "seed_history", seed_positions: [1, 2] },
          projection_version: 3,
          projected_quota: "25.00",
          seed_totals: [
            { position: 1, point_total: "20.00" },
            { position: 2, point_total: "30.00" },
          ],
          settings_history_length: 10,
          settings_method: "moving_average",
          settings_precision: 2,
          settings_rounding_rule: "half_away_from_zero",
          settings_version: 4,
          uses_initial_quota: false,
        },
      ],
      error: null,
    });

    await expect(
      executeGetMemberQuotaBootstrapContext(
        session.userId,
        input.membershipId,
        {
          createClient: () => ({ rpc }),
        },
      ),
    ).resolves.toEqual(
      expect.objectContaining({
        membershipId: input.membershipId,
        projectedQuota: "25.00",
        projectionEffectiveAt: "2026-07-27T09:00:00.000Z",
        seedTotals: [
          { position: 1, pointTotal: "20.00" },
          { position: 2, pointTotal: "30.00" },
        ],
        settingsMethod: "moving_average",
      }),
    );
    expect(rpc).toHaveBeenCalledWith(
      "resolve_membership_quota_bootstrap_context",
      {
        p_actor_user_id: session.userId,
        p_membership_id: input.membershipId,
      },
    );
  });

  it("authenticates first, trims safe fields, and defaults initial use on", async () => {
    const executeBootstrap = vi.fn().mockResolvedValue(result);

    const response = await runMemberQuotaBootstrapMutation(
      {
        ...input,
        initialQuota: " 18.5 ",
        reason: "  Seed this member's quota  ",
        seedTotals: [" 20 ", "30"],
        useInitialQuota: null,
      },
      "20000000-0000-4000-8000-000000000001",
      {
        executeBootstrap,
        verifySession: vi.fn().mockResolvedValue(session),
      },
    );

    expect(response).toEqual({
      ok: true,
      data: result,
      correlationId: "20000000-0000-4000-8000-000000000001",
    });
    expect(executeBootstrap).toHaveBeenCalledWith(
      session.userId,
      {
        ...input,
        initialQuota: "18.5",
        reason: "Seed this member's quota",
        seedTotals: ["20", "30"],
        useInitialQuota: true,
      },
      "20000000-0000-4000-8000-000000000001",
    );
  });

  it("preserves an explicit choice not to freeze an initial quota", async () => {
    const executeBootstrap = vi.fn().mockResolvedValue({
      ...result,
      usesInitialQuota: false,
    });

    const response = await runMemberQuotaBootstrapMutation(
      { ...input, useInitialQuota: false },
      null,
      {
        executeBootstrap,
        verifySession: vi.fn().mockResolvedValue(session),
      },
    );

    expect(response.ok).toBe(true);
    expect(executeBootstrap).toHaveBeenCalledWith(
      session.userId,
      {
        ...input,
        reason: "Seed this member's quota",
        useInitialQuota: false,
      },
      expect.any(String),
    );
  });

  it("rejects an initial-quota freeze without an initial value", async () => {
    const executeBootstrap = vi.fn();
    const response = await runMemberQuotaBootstrapMutation(
      { ...input, initialQuota: null, useInitialQuota: true },
      null,
      {
        executeBootstrap,
        verifySession: vi.fn().mockResolvedValue(session),
      },
    );

    expect(response.ok ? null : response.error.code).toBe("validation");
    expect(response.ok ? null : response.error.fieldErrors).toHaveProperty(
      "useInitialQuota",
    );
    expect(executeBootstrap).not.toHaveBeenCalled();
  });

  it("authenticates before parsing attacker-controlled input", async () => {
    const executeBootstrap = vi.fn();
    const response = await runMemberQuotaBootstrapMutation(null, null, {
      executeBootstrap,
      verifySession: vi
        .fn()
        .mockRejectedValue(new MutationError("authentication_required")),
    });

    expect(response.ok ? null : response.error.code).toBe(
      "authentication_required",
    );
    expect(executeBootstrap).not.toHaveBeenCalled();
  });

  it.each([
    [{ ...input, expectedSettingsVersion: 0 }, "expectedSettingsVersion"],
    [{ ...input, expectedProjectionVersion: -1 }, "expectedProjectionVersion"],
    [{ ...input, confirmed: false }, "confirmed"],
    [
      { ...input, seedTotals: Array.from({ length: 21 }, () => "20") },
      "seedTotals",
    ],
    [{ ...input, groupId: result.groupId }, null],
  ])(
    "rejects invalid or client-authority fields",
    async (invalidInput, field) => {
      const executeBootstrap = vi.fn();
      const response = await runMemberQuotaBootstrapMutation(
        invalidInput,
        null,
        {
          executeBootstrap,
          verifySession: vi.fn().mockResolvedValue(session),
        },
      );

      expect(response.ok).toBe(false);
      expect(response.ok ? null : response.error.code).toBe("validation");
      if (field) {
        expect(response.ok ? null : response.error.fieldErrors).toHaveProperty(
          field,
        );
      }
      expect(executeBootstrap).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["forbidden", "forbidden"],
    ["unavailable", "unavailable"],
    ["stale_version", "stale_version"],
  ] as const)("maps protected RPC error %s", async (code, expectedCode) => {
    const response = await runMemberQuotaBootstrapMutation(input, null, {
      executeBootstrap: vi.fn().mockRejectedValue(new MutationError(code)),
      verifySession: vi.fn().mockResolvedValue(session),
    });

    expect(response.ok ? null : response.error.code).toBe(expectedCode);
  });
});
