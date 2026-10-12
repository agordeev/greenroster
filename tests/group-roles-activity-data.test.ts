import { describe, expect, it, vi } from "vitest";

import {
  formatActivitySummary,
  formatInvitationState,
  parseGroupRolesActivityQuery,
  groupRolesActivityQueryParams,
} from "../apps/web/src/domain/group-roles-activity";
import type { SafeAuditSummary } from "../apps/web/src/domain/group-roles-activity";
import { executeGroupRolesActivity } from "../apps/web/src/lib/groups/group-roles-activity-data";

const actorUserId = "10000000-0000-4000-8000-000000000001";
const groupId = "50000000-0000-4000-8000-000000000001";
const membershipId = "60000000-0000-4000-8000-000000000001";
const secondMembershipId = "60000000-0000-4000-8000-000000000002";
const eventId = "70000000-0000-4000-8000-000000000001";
const secondEventId = "70000000-0000-4000-8000-000000000002";
const correlationId = "80000000-0000-4000-8000-000000000001";
const timestamp = "2026-07-27T10:00:00.000Z";

function summary(overrides: Record<string, unknown> = {}) {
  return {
    kind: "member",
    summary_available: true,
    membership_id: membershipId,
    invitation_id: null,
    import_job_id: null,
    group_version: null,
    membership_version: 2,
    profile_version: null,
    contact_version: null,
    version: null,
    status: "active",
    role: "coordinator",
    dues_paid: null,
    accepted_at: null,
    expires_at: null,
    email_matches: null,
    inactivated_at: null,
    handicap_record_id: null,
    handicap_id: null,
    handicap: null,
    source: "web",
    as_of: null,
    created_at: timestamp,
    quota: null,
    projection_version: null,
    settings_version: null,
    projection_ready: null,
    total_rows: null,
    valid_rows: null,
    invalid_rows: null,
    skipped_rows: null,
    applied_rows: null,
    revision: null,
    cancelled_notification_count: null,
    email_present: null,
    email_verified: null,
    complete: null,
    previous_membership_id: null,
    replacement_membership_id: null,
    band_count: null,
    state: null,
    changed_fields: null,
    ...overrides,
  };
}

function projection() {
  return {
    group: {
      group_id: groupId,
      name: "Fairway Club",
      time_zone: "America/Los_Angeles",
      version: 3,
    },
    roles: [
      {
        membership_id: membershipId,
        first_name: "Alex",
        last_name: "Coordinator",
        role: "coordinator",
        status: "active",
        invitation_state: "accepted",
        invitation_issued_at: timestamp,
        invitation_expires_at: "2026-08-01T10:00:00.000Z",
        invitation_accepted_at: timestamp,
        invitation_revoked_at: null,
        membership_version: 2,
      },
      {
        membership_id: secondMembershipId,
        first_name: "Pat",
        last_name: "Admin",
        role: "administrator",
        status: "pending",
        invitation_state: "pending",
        invitation_issued_at: timestamp,
        invitation_expires_at: "2026-08-01T10:00:00.000Z",
        invitation_accepted_at: null,
        invitation_revoked_at: null,
        membership_version: 1,
      },
    ],
    activity: {
      items: [
        {
          event_id: eventId,
          group_id: groupId,
          actor: {
            membership_id: membershipId,
            display_name: "Alex Coordinator",
            role: "coordinator",
          },
          action: "member.role_changed",
          target: {
            type: "membership",
            id: membershipId,
            version: 2,
          },
          occurred_at: timestamp,
          source: "web",
          correlation_id: correlationId,
          reason: "Operations coverage",
          before: summary({ role: "member" }),
          after: summary(),
        },
        {
          event_id: secondEventId,
          group_id: groupId,
          actor: null,
          action: "system.import_completed",
          target: { type: "import_job", id: null, version: null },
          occurred_at: "2026-07-26T10:00:00.000Z",
          source: "job",
          correlation_id: correlationId,
          reason: null,
          before: null,
          after: summary({ kind: "unknown", summary_available: false }),
        },
      ],
      next_cursor: { occurred_at: timestamp, event_id: secondEventId },
      has_more: true,
    },
  };
}

function visibleSummary(
  overrides: Partial<SafeAuditSummary>,
): SafeAuditSummary {
  return {
    kind: "member",
    summaryAvailable: true,
    status: null,
    role: null,
    duesPaid: null,
    state: null,
    handicap: null,
    source: null,
    asOf: null,
    quota: null,
    complete: null,
    appliedRows: null,
    membershipVersion: null,
    profileVersion: null,
    contactVersion: null,
    version: null,
    projectionVersion: null,
    settingsVersion: null,
    changedFields: null,
    ...overrides,
  } as SafeAuditSummary;
}

describe("group roles and activity data boundary", () => {
  it("strictly maps roles, invitation states, actor redaction, and keyset pagination", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: projection(), error: null });
    const result = await executeGroupRolesActivity(
      actorUserId,
      {
        targetType: "membership",
        targetId: membershipId,
        limit: 10,
        before: { occurredAt: timestamp, eventId },
      },
      { createClient: () => ({ rpc }) },
    );

    expect(rpc).toHaveBeenCalledWith("resolve_group_roles_activity", {
      p_actor_user_id: actorUserId,
      p_target_type: "membership",
      p_target_id: membershipId,
      p_activity_limit: 10,
      p_activity_before_occurred_at: timestamp,
      p_activity_before_id: eventId,
    });
    expect(result.group).toEqual({
      groupId,
      name: "Fairway Club",
      timeZone: "America/Los_Angeles",
      version: 3,
    });
    expect(result.roles.map((role) => role.invitationState)).toEqual([
      "accepted",
      "pending",
    ]);
    expect(result.activity.items[0]).toEqual(
      expect.objectContaining({
        actor: expect.objectContaining({ displayName: "Alex Coordinator" }),
        before: expect.objectContaining({ role: "member" }),
      }),
    );
    expect(result.activity.items[1].actor).toBeNull();
    expect(result.activity.items[1].target?.id).toBeNull();
    expect(result.activity.nextCursor).toEqual({
      occurredAt: timestamp,
      eventId: secondEventId,
    });
    expect(result.activity.hasMore).toBe(true);
  });

  it("rejects undeclared provider or audit fields", async () => {
    const raw = projection();
    const rpc = vi.fn().mockResolvedValue({
      data: {
        ...raw,
        activity: {
          ...raw.activity,
          items: [
            {
              ...raw.activity.items[0],
              before: { ...raw.activity.items[0].before, secret_token: "nope" },
            },
          ],
        },
      },
      error: null,
    });

    await expect(
      executeGroupRolesActivity(
        actorUserId,
        { limit: 25 },
        {
          createClient: () => ({ rpc }),
        },
      ),
    ).rejects.toMatchObject({ code: "unexpected" });
  });

  it("maps service authorization errors without exposing raw provider messages", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { code: "P0003", message: "actor_not_authorized" },
    });
    await expect(
      executeGroupRolesActivity(
        actorUserId,
        { limit: 25 },
        {
          createClient: () => ({ rpc }),
        },
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
  });
});

describe("group roles and activity presentation", () => {
  it("normalizes entity filters and preserves keyset parameters", () => {
    const query = parseGroupRolesActivityQuery({
      target_type: "round",
      target_id: "60000000-0000-4000-8000-000000000003",
      limit: "120",
      before_occurred_at: timestamp,
      before_event_id: eventId,
    });
    expect(query).toEqual({
      targetType: "round",
      targetId: "60000000-0000-4000-8000-000000000003",
      limit: 100,
      before: { occurredAt: timestamp, eventId },
    });
    expect(groupRolesActivityQueryParams(query).toString()).toContain(
      "target_type=round",
    );
    expect(groupRolesActivityQueryParams(query).toString()).toContain(
      "before_event_id=" + eventId,
    );

    expect(
      parseGroupRolesActivityQuery({
        before_occurred_at: "not-a-timestamp",
        before_event_id: eventId,
      }).before,
    ).toBeUndefined();
  });

  it("rejects incomplete or malformed entity filters instead of broadening to all activity", () => {
    expect(
      parseGroupRolesActivityQuery({
        target_type: "",
        target_id: "",
      }).filterError,
    ).toBeUndefined();
    expect(
      parseGroupRolesActivityQuery({ target_id: membershipId }).filterError,
    ).toBe("target_type_required");
    expect(
      parseGroupRolesActivityQuery({ target_type: "membership" }).filterError,
    ).toBe("target_id_required");
    expect(
      parseGroupRolesActivityQuery({
        target_type: "membership",
        target_id: "not-a-uuid",
      }).filterError,
    ).toBe("target_id_invalid");
    expect(
      parseGroupRolesActivityQuery({
        target_type: "audit_events",
        target_id: membershipId,
      }).filterError,
    ).toBe("target_type_invalid");
  });

  it("keeps invitation and safe-summary states readable", () => {
    expect(formatInvitationState("accepted")).toBe("Invitation accepted");
    expect(formatInvitationState(null)).toBe("No invitation sent yet");
    expect(
      formatActivitySummary(
        visibleSummary({
          status: "active",
          role: "coordinator",
          duesPaid: true,
          profileVersion: 3,
          contactVersion: 4,
        }),
      ),
    ).toBe("Status: active · Role: Coordinator · Dues: paid");
    expect(
      formatActivitySummary(
        visibleSummary({
          kind: "handicap",
          handicap: "8.40",
          source: "manual",
          asOf: "2026-07-27",
        }),
      ),
    ).toBe("Handicap: 8.40 (entered by hand · 2026-07-27)");
    expect(
      formatActivitySummary(
        visibleSummary({
          status: "active",
          role: "coordinator",
        }),
      ),
    ).toBe("Status: active · Role: Coordinator");
    expect(
      formatActivitySummary(
        visibleSummary({
          kind: "group",
          groupVersion: 2,
          changedFields: ["name", "time_zone"],
        }),
      ),
    ).toBe("Changed: name, time zone");
  });
});
