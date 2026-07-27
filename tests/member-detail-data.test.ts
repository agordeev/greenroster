import { describe, expect, it, vi } from "vitest";

import { executeGetMemberDetailProjection } from "../apps/web/src/lib/memberships/member-detail-data";
import { MutationError } from "../apps/web/src/lib/mutations/result";

const actorUserId = "10000000-0000-4000-8000-000000000001";
const membershipId = "60000000-0000-4000-8000-000000000001";
const groupId = "50000000-0000-4000-8000-000000000001";
const timestamp = "2026-07-27T10:00:00.000Z";

function detailRow() {
  return {
    membership_id: membershipId,
    group_id: groupId,
    actor_role: "administrator",
    account_email: "member@example.test",
    invitations: [
      {
        invitation_id: "70000000-0000-4000-8000-000000000001",
        invited_email: "invite@example.test",
        role: "member",
        status: "accepted",
        issued_at: timestamp,
        expires_at: "2026-08-03T10:00:00.000Z",
        accepted_at: timestamp,
        revoked_at: null,
        expired_at: null,
        version: 2,
      },
    ],
    deliveries: [
      {
        delivery_id: "71000000-0000-4000-8000-000000000001",
        event_type: "membership.invitation",
        recipient_address: "invite@example.test",
        channel: "email",
        state: "sent",
        attempts: 1,
        failure_reason: null,
        suppression_reason: null,
        sent_at: timestamp,
        created_at: timestamp,
        updated_at: timestamp,
      },
    ],
    quota: {
      current: {
        projection_version: 1,
        projection_ready: true,
        projected_quota: "18.5",
        projection_source: { kind: "initial_quota" },
        effective_at: timestamp,
      },
      admin: {
        initial_quota: "18.5",
        uses_initial_quota: true,
        initial_quota_provenance: "administrator",
        seed_totals: [{ position: 1, point_total: "20" }],
        settings: {
          version: 1,
          method: "moving_average",
          history_length: 5,
          precision: 1,
          rounding_rule: "half_away_from_zero",
          adjustment_bands: [],
        },
      },
      history: [
        {
          event_id: "74000000-0000-4000-8000-000000000001",
          projection_version: 1,
          settings_version: 1,
          projection_ready: true,
          projected_quota: "18.5",
          projection_source: { kind: "initial_quota" },
          occurred_at: timestamp,
          reason: "Initial setup",
          source: "server",
          admin: {
            initial_quota: "18.5",
            uses_initial_quota: true,
            initial_quota_provenance: "member_bootstrap",
            seed_totals: [{ position: 1, point_total: "20" }],
          },
        },
      ],
    },
    handicaps: {
      current: {
        id: "72000000-0000-4000-8000-000000000001",
        handicap_id: "GHIN-1",
        value: "7.2",
        source: "import",
        as_of: "2026-07-27",
        created_at: timestamp,
      },
      all: [
        {
          id: "72000000-0000-4000-8000-000000000001",
          handicap_id: "GHIN-1",
          value: "7.2",
          source: "import",
          as_of: "2026-07-27",
          created_at: timestamp,
        },
      ],
    },
    activity: [
      {
        event_id: "73000000-0000-4000-8000-000000000001",
        action: "member.updated",
        source: "web",
        reason: "Corrected profile",
        target_version: 2,
        occurred_at: timestamp,
      },
    ],
  };
}

describe("member detail data boundary", () => {
  it("strictly maps the authorized service projection", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [detailRow()], error: null });
    const detail = await executeGetMemberDetailProjection(
      actorUserId,
      membershipId,
      { createClient: () => ({ rpc }) },
    );

    expect(rpc).toHaveBeenCalledWith("get_member_detail_projection", {
      p_actor_user_id: actorUserId,
      p_membership_id: membershipId,
    });
    expect(detail).toEqual(
      expect.objectContaining({
        membershipId,
        accountEmail: "member@example.test",
        quota: expect.objectContaining({ projectedQuota: "18.5" }),
        handicaps: [expect.objectContaining({ handicap: "7.2" })],
      }),
    );
    expect(detail.quota.history[0]).toEqual(
      expect.objectContaining({
        projectedQuota: "18.5",
        administratorDetails: expect.objectContaining({
          seedTotals: [{ position: 1, pointTotal: "20" }],
        }),
      }),
    );
    expect(detail.activity[0]).not.toHaveProperty("actorUserId");
  });

  it("rejects undeclared fields instead of passing raw provider or audit data", async () => {
    const row = detailRow();
    const rpc = vi.fn().mockResolvedValue({
      data: [{ ...row, provider_payload: { secret: true } }],
      error: null,
    });

    await expect(
      executeGetMemberDetailProjection(actorUserId, membershipId, {
        createClient: () => ({ rpc }),
      }),
    ).rejects.toMatchObject({ code: "unexpected" });
  });

  it("rejects a current handicap that differs from the ordered history", async () => {
    const row = detailRow();
    const rpc = vi.fn().mockResolvedValue({
      data: [
        {
          ...row,
          handicaps: { ...row.handicaps, current: null },
        },
      ],
      error: null,
    });

    await expect(
      executeGetMemberDetailProjection(actorUserId, membershipId, {
        createClient: () => ({ rpc }),
      }),
    ).rejects.toMatchObject({ code: "unexpected" });
  });

  it("rejects administrator-only quota data in a coordinator projection", async () => {
    const row = detailRow();
    const rpc = vi.fn().mockResolvedValue({
      data: [{ ...row, actor_role: "coordinator" }],
      error: null,
    });

    await expect(
      executeGetMemberDetailProjection(actorUserId, membershipId, {
        createClient: () => ({ rpc }),
      }),
    ).rejects.toMatchObject({ code: "unexpected" });

    const coordinatorRpc = vi.fn().mockResolvedValue({
      data: [
        {
          ...row,
          actor_role: "coordinator",
          quota: {
            ...row.quota,
            admin: null,
            history: row.quota.history.map((entry) => ({
              ...entry,
              admin: null,
            })),
          },
        },
      ],
      error: null,
    });
    await expect(
      executeGetMemberDetailProjection(actorUserId, membershipId, {
        createClient: () => ({ rpc: coordinatorRpc }),
      }),
    ).resolves.toMatchObject({ actorRole: "coordinator" });
  });

  it("rejects a mismatched target and maps uniform authorization denials", async () => {
    const wrongTargetRpc = vi.fn().mockResolvedValue({
      data: [
        {
          ...detailRow(),
          membership_id: "60000000-0000-4000-8000-000000000002",
        },
      ],
      error: null,
    });
    await expect(
      executeGetMemberDetailProjection(actorUserId, membershipId, {
        createClient: () => ({ rpc: wrongTargetRpc }),
      }),
    ).rejects.toBeInstanceOf(MutationError);

    const deniedRpc = vi.fn().mockResolvedValue({
      data: null,
      error: { code: "P0003", message: "actor_not_authorized" },
    });
    await expect(
      executeGetMemberDetailProjection(actorUserId, membershipId, {
        createClient: () => ({ rpc: deniedRpc }),
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
  });
});
