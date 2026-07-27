import { z } from "zod";

import type { VerifiedMutationSession } from "../auth/verify-mutation-session";
import { runVerifiedMutation } from "../mutations/run-verified-mutation";
import type { MutationResult } from "../mutations/result";

const nullableText = (max: number) =>
  z.preprocess(
    (value) =>
      value === null || value === undefined
        ? null
        : typeof value === "string"
          ? value.trim() || null
          : value,
    z.string().max(max).nullable(),
  );

const nullableEmail = z.preprocess(
  (value) =>
    value === null || value === undefined
      ? null
      : typeof value === "string"
        ? value.trim() || null
        : value,
  z.string().max(320).toLowerCase().pipe(z.email()).nullable(),
);

const nullableTee = z.preprocess(
  (value) =>
    value === null || value === undefined
      ? null
      : typeof value === "string"
        ? value.trim().toLowerCase() || null
        : value,
  z.enum(["pro", "back", "middle", "front"]).nullable(),
);

const confirmation = z.literal(true, {
  error: "Confirm the member status change before continuing.",
});

export const memberEditInputSchema = z
  .object({
    membershipId: z.uuid(),
    firstName: z.string().trim().min(1).max(100),
    lastName: z.string().trim().min(1).max(100),
    spouseFirstName: nullableText(100),
    spouseLastName: nullableText(100),
    teeLocation: nullableTee,
    duesPaid: z.boolean(),
    secondaryEmail: nullableEmail,
    homePhone: nullableText(64),
    workPhone: nullableText(64),
    mobilePhone: nullableText(64),
    addressLine1: nullableText(200),
    addressLine2: nullableText(200),
    city: nullableText(100),
    stateRegion: nullableText(100),
    postalCode: nullableText(32),
    country: nullableText(100),
    secondaryEmailVisible: z.boolean(),
    homePhoneVisible: z.boolean(),
    workPhoneVisible: z.boolean(),
    mobilePhoneVisible: z.boolean(),
    addressListed: z.boolean(),
    expectedProfileVersion: z.number().int().nonnegative(),
    expectedContactVersion: z.number().int().nonnegative(),
    expectedMembershipVersion: z.number().int().positive(),
    reason: nullableText(500),
    operationId: z.uuid(),
  })
  .strict();

export const memberStatusInputSchema = z
  .object({
    membershipId: z.uuid(),
    newStatus: z.enum(["active", "inactive"]),
    expectedMembershipVersion: z.number().int().positive(),
    confirmed: confirmation,
    reason: z.string().trim().min(1).max(500),
    operationId: z.uuid(),
  })
  .strict();

export const memberRoleInputSchema = z
  .object({
    membershipId: z.uuid(),
    newRole: z.enum(["member", "coordinator", "administrator"]),
    expectedMembershipVersion: z.number().int().positive(),
    confirmed: confirmation,
    reason: z.string().trim().min(1).max(500),
    operationId: z.uuid(),
  })
  .strict();

export type MemberEditInput = z.infer<typeof memberEditInputSchema>;
export type MemberStatusInput = z.infer<typeof memberStatusInputSchema>;
export type MemberRoleInput = z.infer<typeof memberRoleInputSchema>;

export type MemberStatus = "pending" | "active" | "inactive";
export type MemberRole = "member" | "coordinator" | "administrator";

export type ManageableMember = Readonly<{
  membershipId: string;
  groupId: string;
  userId: string | null;
  firstName: string;
  lastName: string;
  spouseFirstName: string | null;
  spouseLastName: string | null;
  teeLocation: "pro" | "back" | "middle" | "front" | null;
  role: MemberRole;
  status: MemberStatus;
  duesPaid: boolean;
  membershipVersion: number;
  profileVersion: number;
  contactVersion: number;
  createdAt: string;
  activatedAt: string | null;
  inactivatedAt: string | null;
}>;

export type MemberPrivateContact = Readonly<{
  membershipId: string;
  groupId: string;
  contactExists: boolean;
  contactVersion: number;
  secondaryEmail: string | null;
  homePhone: string | null;
  workPhone: string | null;
  mobilePhone: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  stateRegion: string | null;
  postalCode: string | null;
  country: string | null;
  secondaryEmailVisible: boolean;
  homePhoneVisible: boolean;
  workPhoneVisible: boolean;
  mobilePhoneVisible: boolean;
  addressListed: boolean;
}>;

export type MemberEditResult = Readonly<{
  membershipId: string;
  groupId: string;
  membershipVersion: number;
  profileVersion: number;
  contactVersion: number;
  status: MemberStatus;
}>;

export type MemberStatusResult = Readonly<{
  membershipId: string;
  groupId: string;
  membershipVersion: number;
  status: "active" | "inactive";
  inactivatedAt: string | null;
  cancelledNotificationCount: number;
}>;

export type MemberRoleResult = Readonly<{
  membershipId: string;
  groupId: string;
  membershipVersion: number;
  oldRole: MemberRole;
  newRole: MemberRole;
  roleChanged: boolean;
}>;

export type MemberMutationDependencies<TInput, TResult> = Readonly<{
  verifySession: () => Promise<VerifiedMutationSession>;
  execute: (
    actorUserId: string,
    input: TInput,
    correlationId: string,
  ) => Promise<TResult>;
}>;

export type MemberOperationState = Readonly<{
  fingerprint: string | null;
  operationId: string | null;
}>;

export type MemberFormKind = "profile" | "status" | "role";

export function memberEditorFingerprint(
  values: unknown,
  editReason: string,
  statusReason: string,
  statusConfirmed = false,
) {
  return JSON.stringify({
    profile: memberProfileFingerprint(values, editReason),
    status: memberStatusFingerprint(statusReason, statusConfirmed),
  });
}

export function memberProfileFingerprint(values: unknown, reason: string) {
  return JSON.stringify({ values, reason });
}

export function memberStatusFingerprint(reason: string, confirmed: boolean) {
  return JSON.stringify({ reason, confirmed });
}

export function memberRoleFingerprint(
  role: MemberRole,
  reason: string,
  confirmed: boolean,
) {
  return JSON.stringify({ role, reason, confirmed });
}

export function shouldAllowMemberFormSubmit(
  form: MemberFormKind,
  dirty: Readonly<{ profile: boolean; status: boolean; role?: boolean }>,
  confirmDiscard: () => boolean,
) {
  const otherFormDirty = (
    Object.entries(dirty) as Array<[MemberFormKind, boolean | undefined]>
  ).some(([kind, isDirty]) => kind !== form && Boolean(isDirty));
  return !otherFormDirty || confirmDiscard();
}

export function retainMemberOperationId(
  state: MemberOperationState,
  kind: "edit" | "status" | "role",
  payload: unknown,
  createId: () => string,
): Readonly<{ fingerprint: string; operationId: string }> {
  const fingerprint = `${kind}:${JSON.stringify(payload)}`;
  const existingOperationId = state.operationId;
  if (state.fingerprint === fingerprint && existingOperationId) {
    return { fingerprint, operationId: existingOperationId };
  }
  return { fingerprint, operationId: createId() };
}

export function memberTargetPermissions(
  actorMembershipId: string,
  actorRole: MemberRole,
  target: Pick<ManageableMember, "membershipId" | "role" | "status">,
) {
  const coordinatorAdminTarget =
    actorRole === "coordinator" && target.role === "administrator";
  return {
    canEdit: !coordinatorAdminTarget,
    canChangeStatus:
      !coordinatorAdminTarget &&
      target.membershipId !== actorMembershipId &&
      (target.status === "active" || target.status === "inactive"),
  } as const;
}

export function canChangeMemberRole(
  actorRole: MemberRole,
  target: Pick<ManageableMember, "role" | "status">,
) {
  return actorRole === "administrator" && target.status === "active";
}

export async function runMemberEditMutation(
  rawInput: unknown,
  correlationCandidate: string | null | undefined,
  dependencies: MemberMutationDependencies<MemberEditInput, MemberEditResult>,
): Promise<MutationResult<MemberEditResult>> {
  return runVerifiedMutation(rawInput, correlationCandidate, {
    execute: dependencies.execute,
    inputSchema: memberEditInputSchema,
    verifySession: dependencies.verifySession,
  });
}

export async function runMemberStatusMutation(
  rawInput: unknown,
  correlationCandidate: string | null | undefined,
  dependencies: MemberMutationDependencies<
    MemberStatusInput,
    MemberStatusResult
  >,
): Promise<MutationResult<MemberStatusResult>> {
  return runVerifiedMutation(rawInput, correlationCandidate, {
    execute: dependencies.execute,
    inputSchema: memberStatusInputSchema,
    verifySession: dependencies.verifySession,
  });
}

export async function runMemberRoleMutation(
  rawInput: unknown,
  correlationCandidate: string | null | undefined,
  dependencies: MemberMutationDependencies<MemberRoleInput, MemberRoleResult>,
): Promise<MutationResult<MemberRoleResult>> {
  return runVerifiedMutation(rawInput, correlationCandidate, {
    execute: dependencies.execute,
    inputSchema: memberRoleInputSchema,
    verifySession: dependencies.verifySession,
  });
}
