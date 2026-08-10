import { z } from "zod";

const directoryAddressSchema = z
  .object({
    line1: z.string().nullable().optional(),
    line2: z.string().nullable().optional(),
    city: z.string().nullable().optional(),
    state_region: z.string().nullable().optional(),
    postal_code: z.string().nullable().optional(),
    country: z.string().nullable().optional(),
  })
  .strict();

export const memberDirectoryPayloadSchema = z
  .object({
    group: z
      .object({
        group_id: z.uuid(),
        name: z.string().min(1),
        time_zone: z.string().min(1),
      })
      .strict(),
    members: z.array(
      z
        .object({
          membership_id: z.uuid(),
          first_name: z.string().nullable(),
          last_name: z.string().nullable(),
          tee_location: z.enum(["pro", "back", "middle", "front"]).nullable(),
          secondary_email: z.string().nullable().optional(),
          home_phone: z.string().nullable().optional(),
          work_phone: z.string().nullable().optional(),
          mobile_phone: z.string().nullable().optional(),
          address: directoryAddressSchema.optional(),
        })
        .strict(),
    ),
  })
  .strict();

export type MemberDirectory = Readonly<{
  group: Readonly<{ groupId: string; name: string; timeZone: string }>;
  members: readonly Readonly<{
    membershipId: string;
    firstName: string;
    lastName: string;
    teeLocation: "pro" | "back" | "middle" | "front" | null;
    secondaryEmail: string | null;
    homePhone: string | null;
    workPhone: string | null;
    mobilePhone: string | null;
    address: Readonly<{
      line1: string | null;
      line2: string | null;
      city: string | null;
      stateRegion: string | null;
      postalCode: string | null;
      country: string | null;
    }> | null;
  }>[];
}>;

export function memberDirectoryFromPayload(
  value: z.infer<typeof memberDirectoryPayloadSchema>,
): MemberDirectory {
  return {
    group: {
      groupId: value.group.group_id,
      name: value.group.name,
      timeZone: value.group.time_zone,
    },
    members: value.members.map((member) => ({
      membershipId: member.membership_id,
      firstName: member.first_name ?? "",
      lastName: member.last_name ?? "",
      teeLocation: member.tee_location,
      secondaryEmail: member.secondary_email ?? null,
      homePhone: member.home_phone ?? null,
      workPhone: member.work_phone ?? null,
      mobilePhone: member.mobile_phone ?? null,
      address: member.address
        ? {
            line1: member.address.line1 ?? null,
            line2: member.address.line2 ?? null,
            city: member.address.city ?? null,
            stateRegion: member.address.state_region ?? null,
            postalCode: member.address.postal_code ?? null,
            country: member.address.country ?? null,
          }
        : null,
    })),
  };
}
