import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../apps/mobile/src/lib/mobile-operation-id", () => ({
  createMobileOperationId: vi.fn(() => "40000000-0000-4000-8000-000000000001"),
}));
vi.mock("../apps/mobile/src/lib/auth/mobile-supabase", () => ({
  mobileSupabase: { rpc: vi.fn() },
}));

import { createMobileSelfProfileApi } from "../apps/mobile/src/lib/profile/mobile-self-profile-api";

const baseRow = {
  membership_id: "10000000-0000-4000-8000-000000000001",
  group_id: "20000000-0000-4000-8000-000000000001",
  user_id: "30000000-0000-4000-8000-000000000001",
  group_name: "Fairway Club",
  group_time_zone: "America/Los_Angeles",
  role: "member",
  status: "active",
  membership_version: 4,
  profile_version: 2,
  contact_version: 3,
  first_name: "Alice",
  last_name: "Admin",
  spouse_first_name: null,
  spouse_last_name: null,
  tee_location: "middle",
  secondary_email: "alice@example.com",
  home_phone_display: null,
  work_phone_display: null,
  mobile_phone_display: "+15551001001",
  address_line1: "1 Main Street",
  address_line2: null,
  city: "Fairway",
  state_region: "CA",
  postal_code: "90210",
  country: "US",
  secondary_email_visible: false,
  home_phone_visible: false,
  work_phone_visible: true,
  mobile_phone_visible: true,
  address_listed: false,
  handicap_record_id: "40000000-0000-4000-8000-000000000002",
  handicap_id: "GHIN-1",
  handicap: 7.6,
  handicap_source: "manual",
  handicap_as_of: "2026-07-27",
  handicap_created_at: "2026-07-27T00:00:00Z",
};

describe("mobile self-profile API", () => {
  let rpc: ReturnType<typeof vi.fn>;
  let api: ReturnType<typeof createMobileSelfProfileApi>;

  beforeEach(() => {
    rpc = vi.fn();
    api = createMobileSelfProfileApi({ rpc });
  });

  it("resolves the actor-derived flat profile projection", async () => {
    rpc.mockResolvedValue({ data: [baseRow], error: null });
    await expect(api.resolve()).resolves.toMatchObject({
      ok: true,
      data: {
        membershipId: baseRow.membership_id,
        groupName: "Fairway Club",
        draft: { firstName: "Alice", secondaryEmail: "alice@example.com" },
        handicap: "7.6",
      },
    });
    expect(rpc).toHaveBeenCalledWith("resolve_mobile_member_self_profile");
  });

  it("returns the first normalized field path for focusable validation feedback", async () => {
    await expect(
      api.update({
        firstName: "",
        lastName: "Admin",
        expectedProfileVersion: 2,
        expectedContactVersion: 3,
        expectedMembershipVersion: 4,
      }),
    ).resolves.toMatchObject({
      code: "validation",
      field: "firstName",
      ok: false,
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("normalizes and sends profile fields with optimistic versions and operation context", async () => {
    rpc.mockResolvedValueOnce({ data: [{}], error: null });
    rpc.mockResolvedValueOnce({ data: [baseRow], error: null });
    const result = await api.update(
      {
        firstName: " Alice ",
        lastName: " Admin ",
        spouseFirstName: null,
        spouseLastName: null,
        teeLocation: " MIDDLE ",
        secondaryEmail: " Alice@EXAMPLE.com ",
        homePhone: null,
        workPhone: null,
        mobilePhone: "+15551001001",
        addressLine1: "1 Main Street",
        addressLine2: null,
        city: "Fairway",
        stateRegion: "CA",
        postalCode: "90210",
        country: "US",
        secondaryEmailVisible: false,
        homePhoneVisible: false,
        workPhoneVisible: false,
        mobilePhoneVisible: true,
        addressListed: false,
        expectedProfileVersion: 2,
        expectedContactVersion: 3,
        expectedMembershipVersion: 4,
      },
      {
        correlationId: "40000000-0000-4000-8000-000000000010",
        operationId: "40000000-0000-4000-8000-000000000011",
      },
    );
    expect(result.ok).toBe(true);
    expect(rpc).toHaveBeenNthCalledWith(
      1,
      "update_mobile_member_self_profile",
      {
        p_first_name: "Alice",
        p_last_name: "Admin",
        p_spouse_first_name: null,
        p_spouse_last_name: null,
        p_tee_location: "middle",
        p_secondary_email: "alice@example.com",
        p_home_phone: null,
        p_work_phone: null,
        p_mobile_phone: "+15551001001",
        p_address_line1: "1 Main Street",
        p_address_line2: null,
        p_city: "Fairway",
        p_state_region: "CA",
        p_postal_code: "90210",
        p_country: "US",
        p_secondary_email_visible: false,
        p_home_phone_visible: false,
        p_work_phone_visible: false,
        p_mobile_phone_visible: true,
        p_address_listed: false,
        p_expected_profile_version: 2,
        p_expected_contact_version: 3,
        p_expected_membership_version: 4,
        p_reason: null,
        p_correlation_id: "40000000-0000-4000-8000-000000000010",
        p_operation_id: "40000000-0000-4000-8000-000000000011",
      },
    );
  });

  it("requires a confirmed bounded manual handicap and maps stale errors", async () => {
    await expect(
      api.setHandicap({
        handicapId: "GHIN-1",
        handicap: "99.9",
        asOf: "2026-07-27",
        expectedMembershipVersion: 4,
        confirmed: true,
        reason: "Correction",
      }),
    ).resolves.toMatchObject({ code: "validation", ok: false });
    expect(rpc).not.toHaveBeenCalled();

    rpc.mockResolvedValue({
      data: null,
      error: { message: "member_membership_version_changed" },
    });
    await expect(
      api.setHandicap({
        handicapId: "GHIN-1",
        handicap: "7.6",
        asOf: "2026-07-27",
        expectedMembershipVersion: 4,
        confirmed: true,
        reason: "Correction",
      }),
    ).resolves.toMatchObject({ code: "stale", ok: false });
  });

  it("allows a caller to replay an ambiguous committed update with the same context", async () => {
    const input = {
      firstName: "Alice",
      lastName: "Admin",
      spouseFirstName: null,
      spouseLastName: null,
      teeLocation: "middle" as const,
      secondaryEmail: "alice@example.com",
      homePhone: null,
      workPhone: null,
      mobilePhone: "+15551001001",
      addressLine1: "1 Main Street",
      addressLine2: null,
      city: "Fairway",
      stateRegion: "CA",
      postalCode: "90210",
      country: "US",
      secondaryEmailVisible: false,
      homePhoneVisible: false,
      workPhoneVisible: false,
      mobilePhoneVisible: true,
      addressListed: false,
      expectedProfileVersion: 2,
      expectedContactVersion: 3,
      expectedMembershipVersion: 4,
    };
    const operationContext = {
      correlationId: "40000000-0000-4000-8000-000000000010",
      operationId: "40000000-0000-4000-8000-000000000011",
    };
    rpc
      .mockResolvedValueOnce({ data: [{}], error: null })
      .mockResolvedValueOnce({
        data: null,
        error: { message: "network_unavailable" },
      })
      .mockResolvedValueOnce({ data: [{}], error: null })
      .mockResolvedValueOnce({ data: [baseRow], error: null });
    const first = await api.update(input, operationContext);
    const retry = await api.update(input, operationContext);
    expect(first).toMatchObject({ code: "unavailable", ok: false });
    expect(retry).toMatchObject({ ok: true });
    expect(rpc).toHaveBeenNthCalledWith(
      1,
      "update_mobile_member_self_profile",
      expect.objectContaining({ p_operation_id: operationContext.operationId }),
    );
    expect(rpc).toHaveBeenNthCalledWith(
      3,
      "update_mobile_member_self_profile",
      expect.objectContaining({ p_operation_id: operationContext.operationId }),
    );
  });

  it("fails closed on malformed projections and permission errors", async () => {
    rpc.mockResolvedValue({
      data: [{ ...baseRow, role: "owner" }],
      error: null,
    });
    await expect(api.resolve()).resolves.toMatchObject({
      code: "unavailable",
      ok: false,
    });
    rpc.mockResolvedValue({
      data: null,
      error: { message: "actor_not_authorized" },
    });
    await expect(api.resolve()).resolves.toMatchObject({
      code: "permission_denied",
      ok: false,
    });
    rpc.mockResolvedValue({
      data: null,
      error: { message: "recovery_session_forbidden" },
    });
    await expect(api.resolve()).resolves.toMatchObject({
      code: "permission_denied",
      ok: false,
    });
  });
});
