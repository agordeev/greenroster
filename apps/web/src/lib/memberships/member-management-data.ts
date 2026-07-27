import "server-only";

import { z } from "zod";

import {
  memberRosterRpcArgs,
  type MemberRosterQuery,
} from "../../domain/member-roster-query";

import {
  type ManageableMember,
  type ManageableMemberRosterRow,
  type MemberEditInput,
  type MemberEditResult,
  type MemberPrivateContact,
  type MemberRoleInput,
  type MemberRoleResult,
  type MemberStatusInput,
  type MemberStatusResult,
} from "./member-management";
import { MutationError } from "../mutations/result";

type SupabaseRpcError = Readonly<{ code?: string; message?: string }>;

type RpcClient = Readonly<{
  rpc: (
    functionName: string,
    args: Readonly<Record<string, unknown>>,
  ) => PromiseLike<Readonly<{ data: unknown; error: SupabaseRpcError | null }>>;
}>;

export type MemberManagementDataDependencies = Readonly<{
  createClient: () => RpcClient | Promise<RpcClient>;
}>;

const defaultDependencies: MemberManagementDataDependencies = {
  createClient: async () => {
    const { createSupabaseServiceClient } =
      await import("../supabase/service-client");
    return createSupabaseServiceClient();
  },
};

const memberRowSchema = z
  .object({
    membership_id: z.uuid(),
    group_id: z.uuid(),
    user_id: z.uuid().nullable(),
    first_name: z.string().nullable(),
    last_name: z.string().nullable(),
    spouse_first_name: z.string().nullable(),
    spouse_last_name: z.string().nullable(),
    tee_location: z.enum(["pro", "back", "middle", "front"]).nullable(),
    role: z.enum(["member", "coordinator", "administrator"]),
    status: z.enum(["pending", "active", "inactive"]),
    dues_paid: z.boolean(),
    membership_version: z.number().int().positive(),
    profile_version: z.number().int().nonnegative(),
    contact_version: z.number().int().nonnegative(),
    created_at: z.string().datetime({ offset: true }),
    activated_at: z.string().datetime({ offset: true }).nullable(),
    inactivated_at: z.string().datetime({ offset: true }).nullable(),
  })
  .strict();

const decimalValueSchema = z
  .union([z.string(), z.number()])
  .transform((value) => String(value).trim())
  .nullable();
const countSchema = z
  .union([z.number().int().nonnegative(), z.string().regex(/^\d+$/)])
  .transform((value) => Number(value));
const rosterRowSchema = z
  .object({
    membership_id: z.uuid(),
    first_name: z.string().nullable(),
    last_name: z.string().nullable(),
    status: z.enum(["pending", "active", "inactive"]),
    role: z.enum(["member", "coordinator", "administrator"]),
    dues_paid: z.boolean(),
    tee_location: z.enum(["pro", "back", "middle", "front"]).nullable(),
    handicap_value: decimalValueSchema,
    handicap_source: z.enum(["manual", "import"]).nullable(),
    handicap_as_of: z.iso.date().nullable(),
    handicap_id: z.string().nullable(),
    current_quota: decimalValueSchema,
    current_quota_provenance: z.record(z.string(), z.unknown()).nullable(),
    current_quota_effective_at: z
      .string()
      .datetime({ offset: true })
      .nullable(),
    uses_initial_quota: z.boolean(),
    date_added: z.string().datetime({ offset: true }),
    invitation_state: z
      .enum(["pending", "accepted", "revoked", "expired"])
      .nullable(),
    invitation_delivery_action_required: z.boolean(),
  })
  .strict();
const rosterEnvelopeSchema = z
  .object({
    total_count: countSchema,
    active_count: countSchema,
    rows: z.array(rosterRowSchema),
  })
  .strict();

const privateContactRowSchema = z
  .object({
    membership_id: z.uuid(),
    group_id: z.uuid(),
    contact_exists: z.boolean(),
    contact_version: z.number().int().nonnegative(),
    secondary_email: z.string().nullable(),
    home_phone_display: z.string().nullable(),
    work_phone_display: z.string().nullable(),
    mobile_phone_display: z.string().nullable(),
    address_line1: z.string().nullable(),
    address_line2: z.string().nullable(),
    city: z.string().nullable(),
    state_region: z.string().nullable(),
    postal_code: z.string().nullable(),
    country: z.string().nullable(),
    secondary_email_visible: z.boolean(),
    home_phone_visible: z.boolean(),
    work_phone_visible: z.boolean(),
    mobile_phone_visible: z.boolean(),
    address_listed: z.boolean(),
  })
  .strict();

const editResultRowSchema = z
  .object({
    edited_membership_id: z.uuid(),
    edited_group_id: z.uuid(),
    membership_version: z.number().int().positive(),
    profile_version: z.number().int().nonnegative(),
    contact_version: z.number().int().nonnegative(),
    status: z.enum(["pending", "active", "inactive"]),
  })
  .strict();

const statusResultRowSchema = z
  .object({
    changed_membership_id: z.uuid(),
    changed_group_id: z.uuid(),
    membership_version: z.number().int().positive(),
    status: z.enum(["active", "inactive"]),
    inactivated_at: z.string().datetime({ offset: true }).nullable(),
    cancelled_notification_count: z.number().int().nonnegative(),
  })
  .strict();

const roleResultRowSchema = z
  .object({
    membership_id: z.uuid(),
    group_id: z.uuid(),
    membership_version: z.number().int().positive(),
    old_role: z.enum(["member", "coordinator", "administrator"]),
    new_role: z.enum(["member", "coordinator", "administrator"]),
    role_changed: z.boolean(),
  })
  .strict();

function mapMemberError(error: SupabaseRpcError): MutationError {
  if (error.code === "P0003")
    return new MutationError("forbidden", { cause: error });
  if (error.code === "P0002")
    return new MutationError("unavailable", { cause: error });
  if (error.code === "40001")
    return new MutationError("stale_version", { cause: error });
  if (error.code === "P0001")
    return new MutationError("locked", { cause: error });
  if (
    error.code === "22003" ||
    error.code === "22004" ||
    error.code === "22023" ||
    error.code === "22P02" ||
    error.code === "23502" ||
    error.code === "23503" ||
    error.code === "23505" ||
    error.code === "23514"
  ) {
    return new MutationError("validation", { cause: error });
  }
  if (!error.code) return new MutationError("transient", { cause: error });
  return new MutationError("unexpected", { cause: error });
}

function oneRow<T>(schema: z.ZodType<T>, data: unknown): T {
  const parsed = z.array(schema).length(1).safeParse(data);
  if (!parsed.success)
    throw new MutationError("unexpected", { cause: parsed.error });
  return parsed.data[0] as T;
}

function mapMember(row: z.infer<typeof memberRowSchema>): ManageableMember {
  return {
    membershipId: row.membership_id,
    groupId: row.group_id,
    userId: row.user_id,
    firstName: row.first_name ?? "",
    lastName: row.last_name ?? "",
    spouseFirstName: row.spouse_first_name,
    spouseLastName: row.spouse_last_name,
    teeLocation: row.tee_location,
    role: row.role,
    status: row.status,
    duesPaid: row.dues_paid,
    membershipVersion: row.membership_version,
    profileVersion: row.profile_version,
    contactVersion: row.contact_version,
    createdAt: row.created_at,
    activatedAt: row.activated_at,
    inactivatedAt: row.inactivated_at,
  };
}

export async function executeListManageableMembers(
  actorUserId: string,
  overrides?: Partial<MemberManagementDataDependencies>,
): Promise<readonly ManageableMember[]> {
  const dependencies = { ...defaultDependencies, ...overrides };
  const client = await dependencies.createClient();
  const { data, error } = await client.rpc("list_manageable_members", {
    p_actor_user_id: actorUserId,
  });
  if (error) throw mapMemberError(error);
  const parsed = z.array(memberRowSchema).safeParse(data);
  if (!parsed.success)
    throw new MutationError("unexpected", { cause: parsed.error });
  return parsed.data.map(mapMember);
}

function mapRosterRow(
  row: z.infer<typeof rosterRowSchema>,
): ManageableMemberRosterRow {
  return {
    membershipId: row.membership_id,
    firstName: row.first_name ?? "",
    lastName: row.last_name ?? "",
    status: row.status,
    role: row.role,
    duesPaid: row.dues_paid,
    teeLocation: row.tee_location,
    handicapValue: row.handicap_value,
    handicapSource: row.handicap_source,
    handicapAsOf: row.handicap_as_of,
    handicapId: row.handicap_id,
    currentQuota: row.current_quota,
    currentQuotaProvenance: row.current_quota_provenance,
    currentQuotaEffectiveAt: row.current_quota_effective_at,
    usesInitialQuota: row.uses_initial_quota,
    dateAdded: row.date_added,
    invitationState: row.invitation_state,
    invitationDeliveryActionRequired: row.invitation_delivery_action_required,
  };
}

export async function executeListManageableMemberRoster(
  actorUserId: string,
  query: MemberRosterQuery,
  overrides?: Partial<MemberManagementDataDependencies>,
): Promise<
  Readonly<{
    activeCount: number;
    members: readonly ManageableMemberRosterRow[];
    totalCount: number;
  }>
> {
  const dependencies = { ...defaultDependencies, ...overrides };
  const client = await dependencies.createClient();
  const { data, error } = await client.rpc(
    "list_manageable_member_roster",
    memberRosterRpcArgs(actorUserId, query),
  );
  if (error) throw mapMemberError(error);
  const parsed = rosterEnvelopeSchema.safeParse(data);
  if (!parsed.success) {
    throw new MutationError("unexpected", { cause: parsed.error });
  }
  return {
    activeCount: parsed.data.active_count,
    totalCount: parsed.data.total_count,
    members: parsed.data.rows.map(mapRosterRow),
  };
}

export async function executeGetManageableMember(
  actorUserId: string,
  membershipId: string,
  overrides?: Partial<MemberManagementDataDependencies>,
): Promise<ManageableMember> {
  const dependencies = { ...defaultDependencies, ...overrides };
  const client = await dependencies.createClient();
  const { data, error } = await client.rpc("get_manageable_member", {
    p_actor_user_id: actorUserId,
    p_membership_id: membershipId,
  });
  if (error) throw mapMemberError(error);
  return mapMember(oneRow(memberRowSchema, data));
}

export async function executeGetMemberPrivateContactDetail(
  actorUserId: string,
  membershipId: string,
  correlationId: string,
  overrides?: Partial<MemberManagementDataDependencies>,
): Promise<MemberPrivateContact> {
  const dependencies = { ...defaultDependencies, ...overrides };
  const client = await dependencies.createClient();
  const { data, error } = await client.rpc(
    "get_member_private_contact_detail",
    {
      p_actor_user_id: actorUserId,
      p_membership_id: membershipId,
      p_correlation_id: correlationId,
    },
  );
  if (error) throw mapMemberError(error);
  const row = oneRow(privateContactRowSchema, data);
  return {
    membershipId: row.membership_id,
    groupId: row.group_id,
    contactExists: row.contact_exists,
    contactVersion: row.contact_version,
    secondaryEmail: row.secondary_email,
    homePhone: row.home_phone_display,
    workPhone: row.work_phone_display,
    mobilePhone: row.mobile_phone_display,
    addressLine1: row.address_line1,
    addressLine2: row.address_line2,
    city: row.city,
    stateRegion: row.state_region,
    postalCode: row.postal_code,
    country: row.country,
    secondaryEmailVisible: row.secondary_email_visible,
    homePhoneVisible: row.home_phone_visible,
    workPhoneVisible: row.work_phone_visible,
    mobilePhoneVisible: row.mobile_phone_visible,
    addressListed: row.address_listed,
  };
}

export async function executeEditMember(
  actorUserId: string,
  input: MemberEditInput,
  correlationId: string,
  overrides?: Partial<MemberManagementDataDependencies>,
): Promise<MemberEditResult> {
  const dependencies = { ...defaultDependencies, ...overrides };
  const client = await dependencies.createClient();
  const { data, error } = await client.rpc("edit_member", {
    p_actor_user_id: actorUserId,
    p_membership_id: input.membershipId,
    p_first_name: input.firstName,
    p_last_name: input.lastName,
    p_spouse_first_name: input.spouseFirstName,
    p_spouse_last_name: input.spouseLastName,
    p_tee_location: input.teeLocation,
    p_dues_paid: input.duesPaid,
    p_secondary_email: input.secondaryEmail,
    p_home_phone: input.homePhone,
    p_work_phone: input.workPhone,
    p_mobile_phone: input.mobilePhone,
    p_address_line1: input.addressLine1,
    p_address_line2: input.addressLine2,
    p_city: input.city,
    p_state_region: input.stateRegion,
    p_postal_code: input.postalCode,
    p_country: input.country,
    p_secondary_email_visible: input.secondaryEmailVisible,
    p_home_phone_visible: input.homePhoneVisible,
    p_work_phone_visible: input.workPhoneVisible,
    p_mobile_phone_visible: input.mobilePhoneVisible,
    p_address_listed: input.addressListed,
    p_expected_profile_version: input.expectedProfileVersion,
    p_expected_contact_version: input.expectedContactVersion,
    p_expected_membership_version: input.expectedMembershipVersion,
    p_reason: input.reason,
    p_correlation_id: correlationId,
    p_operation_id: input.operationId,
  });
  if (error) throw mapMemberError(error);
  const row = oneRow(editResultRowSchema, data);
  if (row.edited_membership_id !== input.membershipId) {
    throw new MutationError("unexpected", {
      cause: new Error("Member edit returned an inconsistent membership"),
    });
  }
  return {
    membershipId: row.edited_membership_id,
    groupId: row.edited_group_id,
    membershipVersion: row.membership_version,
    profileVersion: row.profile_version,
    contactVersion: row.contact_version,
    status: row.status,
  };
}

export async function executeSetMemberStatus(
  actorUserId: string,
  input: MemberStatusInput,
  correlationId: string,
  overrides?: Partial<MemberManagementDataDependencies>,
): Promise<MemberStatusResult> {
  const dependencies = { ...defaultDependencies, ...overrides };
  const client = await dependencies.createClient();
  const { data, error } = await client.rpc("set_member_status", {
    p_actor_user_id: actorUserId,
    p_membership_id: input.membershipId,
    p_new_status: input.newStatus,
    p_expected_membership_version: input.expectedMembershipVersion,
    p_confirmed: input.confirmed,
    p_reason: input.reason,
    p_correlation_id: correlationId,
    p_operation_id: input.operationId,
  });
  if (error) throw mapMemberError(error);
  const row = oneRow(statusResultRowSchema, data);
  if (row.changed_membership_id !== input.membershipId) {
    throw new MutationError("unexpected", {
      cause: new Error("Member status returned an inconsistent membership"),
    });
  }
  return {
    membershipId: row.changed_membership_id,
    groupId: row.changed_group_id,
    membershipVersion: row.membership_version,
    status: row.status,
    inactivatedAt: row.inactivated_at,
    cancelledNotificationCount: row.cancelled_notification_count,
  };
}

export async function executeChangeMemberRole(
  actorUserId: string,
  input: MemberRoleInput,
  correlationId: string,
  overrides?: Partial<MemberManagementDataDependencies>,
): Promise<MemberRoleResult> {
  const dependencies = { ...defaultDependencies, ...overrides };
  const client = await dependencies.createClient();
  const { data, error } = await client.rpc("change_member_role", {
    p_actor_user_id: actorUserId,
    p_membership_id: input.membershipId,
    p_new_role: input.newRole,
    p_expected_membership_version: input.expectedMembershipVersion,
    p_confirmed: input.confirmed,
    p_reason: input.reason,
    p_correlation_id: correlationId,
    p_operation_id: input.operationId,
  });
  if (error) throw mapMemberError(error);
  const row = oneRow(roleResultRowSchema, data);
  if (row.membership_id !== input.membershipId) {
    throw new MutationError("unexpected", {
      cause: new Error("Member role returned an inconsistent membership"),
    });
  }
  return {
    membershipId: row.membership_id,
    groupId: row.group_id,
    membershipVersion: row.membership_version,
    oldRole: row.old_role,
    newRole: row.new_role,
    roleChanged: row.role_changed,
  };
}
