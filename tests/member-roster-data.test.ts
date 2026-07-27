import { describe, expect, it, vi } from "vitest";

import { parseMemberRosterQuery } from "../apps/web/src/domain/member-roster-query";
import { executeListManageableMemberRoster } from "../apps/web/src/lib/memberships/member-management-data";

const actorUserId = "10000000-0000-4000-8000-000000000001";
const membershipId = "60000000-0000-4000-8000-000000000001";

describe("member roster projection adapter", () => {
  it("parses the JSON envelope, preserves exact numeric strings, and maps display fields", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        active_count: "17",
        total_count: "101",
        rows: [
          {
            membership_id: membershipId,
            first_name: "Ada",
            last_name: "Lovelace",
            status: "active",
            role: "member",
            dues_paid: true,
            tee_location: "middle",
            handicap_value: "4.25",
            handicap_source: "manual",
            handicap_as_of: "2026-07-27",
            handicap_id: "GHIN-42",
            current_quota: "18.50",
            current_quota_provenance: { kind: "seed_history" },
            current_quota_effective_at: "2026-07-27T00:00:00.000Z",
            uses_initial_quota: false,
            date_added: "2026-07-26T00:00:00.000Z",
            invitation_state: "accepted",
            invitation_delivery_action_required: false,
          },
        ],
      },
      error: null,
    });
    const query = parseMemberRosterQuery({
      search: "Ada",
      page: "2",
      pageSize: "50",
    });

    await expect(
      executeListManageableMemberRoster(actorUserId, query, {
        createClient: () => ({ rpc }),
      }),
    ).resolves.toEqual({
      activeCount: 17,
      totalCount: 101,
      members: [
        {
          membershipId,
          firstName: "Ada",
          lastName: "Lovelace",
          status: "active",
          role: "member",
          duesPaid: true,
          teeLocation: "middle",
          handicapValue: "4.25",
          handicapSource: "manual",
          handicapAsOf: "2026-07-27",
          handicapId: "GHIN-42",
          currentQuota: "18.50",
          currentQuotaProvenance: { kind: "seed_history" },
          currentQuotaEffectiveAt: "2026-07-27T00:00:00.000Z",
          usesInitialQuota: false,
          dateAdded: "2026-07-26T00:00:00.000Z",
          invitationState: "accepted",
          invitationDeliveryActionRequired: false,
        },
      ],
    });
    expect(rpc).toHaveBeenCalledWith("list_manageable_member_roster", {
      p_actor_user_id: actorUserId,
      p_search: "Ada",
      p_alphabet: null,
      p_status: null,
      p_role: null,
      p_dues_paid: null,
      p_sort_key: "name",
      p_sort_direction: "asc",
      p_limit: 50,
      p_offset: 50,
    });
  });

  it("rejects an envelope with an unrecognized row field", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        active_count: 0,
        total_count: 0,
        rows: [
          {
            membership_id: membershipId,
            first_name: "Ada",
            last_name: "Lovelace",
            status: "active",
            role: "member",
            dues_paid: true,
            tee_location: null,
            handicap_value: null,
            handicap_source: null,
            handicap_as_of: null,
            handicap_id: null,
            current_quota: null,
            current_quota_provenance: null,
            current_quota_effective_at: null,
            uses_initial_quota: false,
            date_added: "2026-07-26T00:00:00.000Z",
            invitation_state: null,
            invitation_delivery_action_required: false,
            private_email: "should-not-cross-this-boundary@example.test",
          },
        ],
      },
      error: null,
    });

    await expect(
      executeListManageableMemberRoster(
        actorUserId,
        parseMemberRosterQuery({}),
        { createClient: () => ({ rpc }) },
      ),
    ).rejects.toMatchObject({ code: "unexpected" });
  });
});
