import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../apps/mobile/src/lib/auth/mobile-supabase", () => ({
  mobileSupabase: { rpc: vi.fn() },
}));

import { createMobileGroupDirectoryApi } from "../apps/mobile/src/lib/group/mobile-group-directory-api";

const membershipId = "60000000-0000-4000-8000-000000000001";
const groupId = "70000000-0000-4000-8000-000000000001";

const directoryPayload = {
  group: {
    group_id: groupId,
    name: "Green Valley Club",
    time_zone: "America/Denver",
  },
  members: [
    {
      membership_id: membershipId,
      first_name: "Ada",
      last_name: "Lovelace",
      tee_location: "middle",
      secondary_email: "ada@example.test",
      home_phone: "+1 555 0101",
      work_phone: "+1 555 0102",
      mobile_phone: "+1 555 0100",
      address: {
        line1: "1 Analytical Way",
        line2: null,
        city: "London",
        state_region: null,
        postal_code: "NW1",
        country: "UK",
      },
    },
  ],
};

describe("mobile group directory API", () => {
  let rpc: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    rpc = vi.fn();
  });

  it("maps the server-owned group and directory projection", async () => {
    rpc.mockResolvedValue({ data: directoryPayload, error: null });
    const api = createMobileGroupDirectoryApi({ rpc });

    await expect(api.resolve("Ada", "L")).resolves.toEqual({
      data: {
        group: {
          groupId,
          name: "Green Valley Club",
          timeZone: "America/Denver",
        },
        members: [
          {
            address: {
              city: "London",
              country: "UK",
              line1: "1 Analytical Way",
              line2: null,
              postalCode: "NW1",
              stateRegion: null,
            },
            firstName: "Ada",
            homePhone: "+1 555 0101",
            lastName: "Lovelace",
            membershipId,
            mobilePhone: "+1 555 0100",
            secondaryEmail: "ada@example.test",
            teeLocation: "middle",
            workPhone: "+1 555 0102",
          },
        ],
      },
      ok: true,
    });
    expect(rpc).toHaveBeenCalledWith("resolve_mobile_group_directory", {
      p_alphabet: "L",
      p_search: "Ada",
    });
  });

  it("normalizes hidden optional contact keys without widening the payload", async () => {
    rpc.mockResolvedValue({
      data: {
        ...directoryPayload,
        members: [
          {
            membership_id: membershipId,
            first_name: "Ada",
            last_name: "Lovelace",
            tee_location: null,
          },
        ],
      },
      error: null,
    });
    const api = createMobileGroupDirectoryApi({ rpc });

    await expect(api.resolve()).resolves.toMatchObject({
      data: {
        members: [
          {
            address: null,
            homePhone: null,
            mobilePhone: null,
            secondaryEmail: null,
            workPhone: null,
          },
        ],
      },
      ok: true,
    });
  });

  it("rejects malformed or overexposed responses", async () => {
    rpc.mockResolvedValue({
      data: {
        ...directoryPayload,
        members: [{ ...directoryPayload.members[0], private_note: "hidden" }],
      },
      error: null,
    });
    const api = createMobileGroupDirectoryApi({ rpc });

    await expect(api.resolve()).resolves.toMatchObject({
      code: "unavailable",
      ok: false,
    });
  });

  it("rejects explicit null privacy keys instead of treating them as hidden", async () => {
    rpc.mockResolvedValue({
      data: {
        ...directoryPayload,
        members: [{ ...directoryPayload.members[0], secondary_email: null }],
      },
      error: null,
    });
    const api = createMobileGroupDirectoryApi({ rpc });

    await expect(api.resolve()).resolves.toMatchObject({
      code: "unavailable",
      ok: false,
    });
  });

  it("rejects an explicit null address key instead of treating it as hidden", async () => {
    rpc.mockResolvedValue({
      data: {
        ...directoryPayload,
        members: [{ ...directoryPayload.members[0], address: null }],
      },
      error: null,
    });
    const api = createMobileGroupDirectoryApi({ rpc });

    await expect(api.resolve()).resolves.toMatchObject({
      code: "unavailable",
      ok: false,
    });
  });

  it("maps authorization and transport failures to safe retryable states", async () => {
    rpc.mockResolvedValueOnce({
      data: null,
      error: { message: "actor_not_authorized" },
    });
    rpc.mockRejectedValueOnce(new Error("network"));
    const api = createMobileGroupDirectoryApi({ rpc });

    await expect(api.resolve()).resolves.toMatchObject({
      code: "permission_denied",
      ok: false,
    });
    await expect(api.resolve()).resolves.toMatchObject({
      code: "unavailable",
      ok: false,
    });
  });
});
