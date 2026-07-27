import { z } from "zod";

import { mobileSupabase } from "../auth/mobile-supabase";

const directoryQuerySchema = z.object({
  search: z.string().trim().max(200),
  alphabet: z
    .string()
    .regex(/^[A-Z]$/)
    .nullable(),
});

const addressSchema = z
  .object({
    line1: z.string().nullable().optional(),
    line2: z.string().nullable().optional(),
    city: z.string().nullable().optional(),
    state_region: z.string().nullable().optional(),
    postal_code: z.string().nullable().optional(),
    country: z.string().nullable().optional(),
  })
  .strict();

const groupSchema = z
  .object({
    group_id: z.uuid(),
    name: z.string().min(1),
    time_zone: z.string().min(1),
  })
  .strict();

const memberSchema = z
  .object({
    membership_id: z.uuid(),
    first_name: z.string().nullable(),
    last_name: z.string().nullable(),
    tee_location: z.enum(["pro", "back", "middle", "front"]).nullable(),
    secondary_email: z.string().min(1).optional(),
    home_phone: z.string().min(1).optional(),
    work_phone: z.string().min(1).optional(),
    mobile_phone: z.string().min(1).optional(),
    address: addressSchema.optional(),
  })
  .strict();

const directoryPayloadSchema = z
  .object({
    group: groupSchema,
    members: z.array(memberSchema),
  })
  .strict();

export type MobileGroupDirectoryQuery = Readonly<{
  alphabet: string | null;
  search: string;
}>;

export type MobileGroupDirectoryGroup = Readonly<{
  groupId: string;
  name: string;
  timeZone: string;
}>;

export type MobileGroupDirectoryAddress = Readonly<{
  city: string | null;
  country: string | null;
  line1: string | null;
  line2: string | null;
  postalCode: string | null;
  stateRegion: string | null;
}>;

export type MobileGroupDirectoryMember = Readonly<{
  address: MobileGroupDirectoryAddress | null;
  firstName: string;
  homePhone: string | null;
  lastName: string;
  membershipId: string;
  mobilePhone: string | null;
  secondaryEmail: string | null;
  teeLocation: "pro" | "back" | "middle" | "front" | null;
  workPhone: string | null;
}>;

export type MobileGroupDirectoryData = Readonly<{
  group: MobileGroupDirectoryGroup;
  members: readonly MobileGroupDirectoryMember[];
}>;

export type MobileGroupDirectoryResult =
  | Readonly<{ data: MobileGroupDirectoryData; ok: true }>
  | Readonly<{
      code: "permission_denied" | "unavailable" | "validation";
      message: string;
      ok: false;
    }>;

type MobileGroupDirectoryClient = Pick<typeof mobileSupabase, "rpc">;

function unavailableResult(): MobileGroupDirectoryResult {
  return {
    code: "unavailable",
    message:
      "GreenRoster could not load your group directory. Check your connection and try again.",
    ok: false,
  };
}

function mapDirectoryError(message: string): MobileGroupDirectoryResult {
  const normalized = message.toLowerCase();
  if (
    normalized.includes("identity_context") ||
    normalized.includes("actor_not_authorized") ||
    normalized.includes("not authorized") ||
    normalized.includes("permission")
  ) {
    return {
      code: "permission_denied",
      message:
        "This account cannot access the group directory. Contact a group administrator.",
      ok: false,
    };
  }
  return unavailableResult();
}

function mapDirectoryData(
  value: z.infer<typeof directoryPayloadSchema>,
): MobileGroupDirectoryData {
  return {
    group: {
      groupId: value.group.group_id,
      name: value.group.name,
      timeZone: value.group.time_zone,
    },
    members: value.members.map((member) => ({
      address: member.address
        ? {
            city: member.address.city ?? null,
            country: member.address.country ?? null,
            line1: member.address.line1 ?? null,
            line2: member.address.line2 ?? null,
            postalCode: member.address.postal_code ?? null,
            stateRegion: member.address.state_region ?? null,
          }
        : null,
      firstName: member.first_name ?? "",
      homePhone: member.home_phone ?? null,
      lastName: member.last_name ?? "",
      membershipId: member.membership_id,
      mobilePhone: member.mobile_phone ?? null,
      secondaryEmail: member.secondary_email ?? null,
      teeLocation: member.tee_location,
      workPhone: member.work_phone ?? null,
    })),
  };
}

export function createMobileGroupDirectoryApi(
  client: MobileGroupDirectoryClient,
) {
  return {
    async resolve(
      search = "",
      alphabet: string | null = null,
    ): Promise<MobileGroupDirectoryResult> {
      const parsedQuery = directoryQuerySchema.safeParse({ search, alphabet });
      if (!parsedQuery.success) {
        return {
          code: "validation",
          message: "Use a shorter search or a valid surname initial.",
          ok: false,
        };
      }

      try {
        const { data, error } = await client.rpc(
          "resolve_mobile_group_directory",
          {
            p_search: parsedQuery.data.search || null,
            p_alphabet: parsedQuery.data.alphabet,
          },
        );
        if (error) return mapDirectoryError(error.message);

        const parsedData = directoryPayloadSchema.safeParse(data);
        if (!parsedData.success) return unavailableResult();
        return { data: mapDirectoryData(parsedData.data), ok: true };
      } catch {
        return unavailableResult();
      }
    },
  };
}

export const mobileGroupDirectoryApi =
  createMobileGroupDirectoryApi(mobileSupabase);
