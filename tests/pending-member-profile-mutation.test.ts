import { describe, expect, it, vi } from "vitest";

import {
  runPendingMemberProfileMutation,
  type PendingMemberProfileResult,
} from "../apps/web/src/lib/memberships/pending-member-profile";
import { MutationError } from "../apps/web/src/lib/mutations/result";

const session = {
  userId: "10000000-0000-4000-8000-000000000001",
  emailConfirmedAt: "2026-07-26T00:00:00.000Z",
};

const input = {
  firstName: "  Ada ",
  lastName: "  Lovelace  ",
  spouseFirstName: "  Charles ",
  spouseLastName: "  Babbage ",
  teeLocation: "  Pro ",
  duesPaid: true,
  secondaryEmail: "  Ada.Secondary@Example.COM ",
  homePhone: "  +1 (555) 010-0001 ",
  workPhone: "  +1 (555) 010-0002 ",
  mobilePhone: "  +1 (555) 010-0003 ",
  addressLine1: "  1 Analytical Engine Way ",
  addressLine2: "  Suite 2 ",
  city: "  London ",
  stateRegion: "  London ",
  postalCode: "  N1 1AA ",
  country: "  United Kingdom ",
  secondaryEmailVisible: true,
  homePhoneVisible: true,
  workPhoneVisible: false,
  mobilePhoneVisible: true,
  addressListed: true,
  reason: "  Add the new member record  ",
  operationId: "30000000-0000-4000-8000-000000000001",
};

const result: PendingMemberProfileResult = {
  membershipId: "60000000-0000-4000-8000-000000000001",
  groupId: "50000000-0000-4000-8000-000000000001",
  profileVersion: 1,
  contactVersion: 1,
};

describe("pending member profile mutation boundary", () => {
  it("authenticates first, normalizes safe fields, and preserves privacy flags", async () => {
    const executeCreate = vi.fn().mockResolvedValue(result);

    const response = await runPendingMemberProfileMutation(
      {
        ...input,
        spouseFirstName: "  ",
        spouseLastName: undefined,
        teeLocation: "  Pro ",
        secondaryEmail: "  ADA.Secondary@Example.COM ",
        homePhone: "  ",
        reason: "  Add the new member record  ",
        secondaryEmailVisible: true,
        homePhoneVisible: false,
      },
      "20000000-0000-4000-8000-000000000001",
      {
        executeCreate,
        verifySession: vi.fn().mockResolvedValue(session),
      },
    );

    expect(response).toEqual({
      ok: true,
      data: result,
      correlationId: "20000000-0000-4000-8000-000000000001",
    });
    expect(executeCreate).toHaveBeenCalledWith(
      session.userId,
      {
        ...input,
        firstName: "Ada",
        lastName: "Lovelace",
        spouseFirstName: null,
        spouseLastName: null,
        teeLocation: "pro",
        secondaryEmail: "ada.secondary@example.com",
        homePhone: null,
        workPhone: "+1 (555) 010-0002",
        mobilePhone: "+1 (555) 010-0003",
        addressLine1: "1 Analytical Engine Way",
        addressLine2: "Suite 2",
        city: "London",
        stateRegion: "London",
        postalCode: "N1 1AA",
        country: "United Kingdom",
        reason: "Add the new member record",
        secondaryEmailVisible: true,
        homePhoneVisible: false,
      },
      "20000000-0000-4000-8000-000000000001",
    );
  });

  it("defaults omitted privacy flags to private and normalizes blank optional fields to null", async () => {
    const executeCreate = vi.fn().mockResolvedValue(result);

    const response = await runPendingMemberProfileMutation(
      {
        firstName: " Grace ",
        lastName: " Hopper ",
        spouseFirstName: " ",
        spouseLastName: null,
        teeLocation: " ",
        secondaryEmail: " ",
        homePhone: " ",
        workPhone: null,
        mobilePhone: undefined,
        addressLine1: " ",
        addressLine2: null,
        city: undefined,
        stateRegion: " ",
        postalCode: " ",
        country: null,
        operationId: input.operationId,
      },
      null,
      {
        executeCreate,
        verifySession: vi.fn().mockResolvedValue(session),
      },
    );

    expect(response.ok).toBe(true);
    expect(executeCreate).toHaveBeenCalledWith(
      session.userId,
      {
        firstName: "Grace",
        lastName: "Hopper",
        spouseFirstName: null,
        spouseLastName: null,
        teeLocation: null,
        duesPaid: false,
        secondaryEmail: null,
        homePhone: null,
        workPhone: null,
        mobilePhone: null,
        addressLine1: null,
        addressLine2: null,
        city: null,
        stateRegion: null,
        postalCode: null,
        country: null,
        secondaryEmailVisible: false,
        homePhoneVisible: false,
        workPhoneVisible: false,
        mobilePhoneVisible: false,
        addressListed: false,
        reason: null,
        operationId: input.operationId,
      },
      expect.any(String),
    );
  });

  it("authenticates before parsing attacker-controlled input", async () => {
    const executeCreate = vi.fn();
    const response = await runPendingMemberProfileMutation(null, null, {
      executeCreate,
      verifySession: vi
        .fn()
        .mockRejectedValue(new MutationError("authentication_required")),
    });

    expect(response.ok ? null : response.error.code).toBe(
      "authentication_required",
    );
    expect(executeCreate).not.toHaveBeenCalled();
  });

  it.each([
    { ...input, groupId: "50000000-0000-4000-8000-000000000999" },
    { ...input, status: "pending" },
    { ...input, role: "member" },
    { ...input, userId: session.userId },
    { ...input, invitationId: "70000000-0000-4000-8000-000000000001" },
    { ...input, normalizedHomePhone: "+15550100001" },
    { ...input, projectionVersion: 1 },
  ])(
    "rejects client-supplied authority or projection field",
    async (invalidInput) => {
      const executeCreate = vi.fn();
      const response = await runPendingMemberProfileMutation(
        invalidInput,
        null,
        {
          executeCreate,
          verifySession: vi.fn().mockResolvedValue(session),
        },
      );

      expect(response.ok ? null : response.error.code).toBe("validation");
      expect(executeCreate).not.toHaveBeenCalled();
    },
  );

  it.each([
    [{ ...input, firstName: " " }, "firstName"],
    [{ ...input, lastName: "x".repeat(101) }, "lastName"],
    [{ ...input, secondaryEmail: "not-an-email" }, "secondaryEmail"],
    [{ ...input, reason: "x".repeat(501) }, "reason"],
    [{ ...input, operationId: "not-a-uuid" }, "operationId"],
    [{ ...input, postalCode: "x".repeat(33) }, "postalCode"],
    [{ ...input, country: "x".repeat(101) }, "country"],
  ])("rejects invalid %s input", async (invalidInput, field) => {
    const executeCreate = vi.fn();
    const response = await runPendingMemberProfileMutation(invalidInput, null, {
      executeCreate,
      verifySession: vi.fn().mockResolvedValue(session),
    });

    expect(response.ok).toBe(false);
    expect(response.ok ? null : response.error.code).toBe("validation");
    expect(response.ok ? null : response.error.fieldErrors).toHaveProperty(
      field,
    );
    expect(executeCreate).not.toHaveBeenCalled();
  });

  it("preserves safe service error classes without exposing database details", async () => {
    for (const [code, expectedCode] of [
      ["forbidden", "forbidden"],
      ["unavailable", "unavailable"],
      ["stale_version", "stale_version"],
      ["locked", "locked"],
      ["validation", "validation"],
      ["unexpected", "unexpected"],
    ] as const) {
      const response = await runPendingMemberProfileMutation(input, null, {
        executeCreate: vi.fn().mockRejectedValue(new MutationError(code)),
        verifySession: vi.fn().mockResolvedValue(session),
      });

      expect(response.ok ? null : response.error.code).toBe(expectedCode);
    }
  });
});
