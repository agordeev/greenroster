import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.APP_URL = "http://127.0.0.1:3000";
  process.env.SUPPORT_EMAIL = "support@greenroster.example";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "publishable-key";
  process.env.SUPABASE_SECRET_KEY = "secret-key";
  process.env.INVITATION_TOKEN_SECRET =
    "correct horse battery staple invitation secret";
  process.env.INVITATION_TTL_HOURS = "48";
  process.env.RESEND_API_KEY = "re_test_synthetic";
  process.env.RESEND_FROM_EMAIL = "notifications@greenroster.test";
  process.env.RESEND_WEBHOOK_SECRET = "whsec_test_synthetic";
  process.env.CRON_SECRET = "test-only-notification-cron-secret-value";
  process.env.NOTIFICATION_EMAIL_MAX_ATTEMPTS = "3";
  process.env.NOTIFICATION_EMAIL_RETRY_SECONDS = "300";
});

import { handlePortalExport } from "../apps/web/src/app/api/portal/exports/route";

const userId = "10000000-0000-4000-8000-000000000001";
const groupId = "20000000-0000-4000-8000-000000000001";

describe("portal export route", () => {
  it("exports all roster pages and records the actor and filter", async () => {
    const audit = vi.fn().mockResolvedValue(undefined);
    const loadRoster = vi.fn().mockResolvedValueOnce({
      activeCount: 1,
      totalCount: 1,
      members: [
        {
          membershipId: "30000000-0000-4000-8000-000000000001",
          firstName: "Ada",
          lastName: "Lovelace",
          status: "active",
          role: "member",
          duesPaid: true,
          teeLocation: "back",
          handicapValue: "12.4",
          handicapSource: "manual",
          handicapAsOf: "2026-08-10",
          handicapId: null,
          currentQuota: "8.5",
          currentQuotaProvenance: null,
          currentQuotaEffectiveAt: "2026-08-10T09:00:00.000Z",
          usesInitialQuota: false,
          dateAdded: "2026-08-01T09:00:00.000Z",
          invitationState: "accepted",
          invitationDeliveryActionRequired: false,
        },
      ],
    });

    const response = await handlePortalExport(
      new Request(
        "http://localhost/api/portal/exports?kind=members&status=active",
      ),
      {
        verifySession: vi.fn().mockResolvedValue({ userId }),
        resolveContext: vi.fn().mockResolvedValue({
          groupId,
          role: "administrator",
        }),
        loadRoster,
        recordAudit: audit,
      },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toContain(
      "greenroster-members.csv",
    );
    expect(await response.text()).toContain('"Ada","Lovelace"');
    expect(loadRoster).toHaveBeenCalledWith(
      userId,
      expect.objectContaining({ status: "active", page: 1, pageSize: 100 }),
    );
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: userId,
        groupId,
        kind: "members",
        rowCount: 1,
        filter: "kind=members&status=active",
      }),
    );
  });

  it("denies members before loading any export data", async () => {
    const loadRoster = vi.fn();
    const response = await handlePortalExport(
      new Request("http://localhost/api/portal/exports?kind=members"),
      {
        verifySession: vi.fn().mockResolvedValue({ userId }),
        resolveContext: vi.fn().mockResolvedValue(null),
        loadRoster,
      },
    );

    expect(response.status).toBe(403);
    expect(loadRoster).not.toHaveBeenCalled();
  });

  it("returns a private no-store PDF with a completed round score pad", async () => {
    const response = await handlePortalExport(
      new Request(
        "http://localhost/api/portal/exports?kind=scorepad&format=pdf&round_id=40000000-0000-4000-8000-000000000001",
      ),
      {
        verifySession: vi.fn().mockResolvedValue({ userId }),
        resolveContext: vi.fn().mockResolvedValue({
          groupId,
          role: "coordinator",
          groupName: "Ada's group",
          timeZone: "UTC",
        }),
        loadResults: vi.fn().mockResolvedValue({
          round: {
            id: "40000000-0000-4000-8000-000000000001",
            group_id: groupId,
            description: "August round",
            scheduled_at: "2026-08-10T09:00:00.000Z",
            group_time_zone: "UTC",
            format: "individual_net",
            state: "completed",
          },
          results: [],
        }),
        recordAudit: vi.fn().mockResolvedValue(undefined),
      },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("content-disposition")).toContain(
      "greenroster-scorepad.pdf",
    );
    expect(new TextDecoder().decode(await response.arrayBuffer())).toContain(
      "August round score pad",
    );
  });
});
