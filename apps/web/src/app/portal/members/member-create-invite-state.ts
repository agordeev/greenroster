import type { MemberRole } from "@/lib/memberships/member-management";

export type TeeLocation = "pro" | "back" | "middle" | "front";

export type MemberCreateInviteDraft = Readonly<{
  firstName: string;
  lastName: string;
  invitedEmail: string;
  spouseFirstName: string;
  spouseLastName: string;
  teeLocation: TeeLocation | "";
  duesPaid: boolean;
  secondaryEmail: string;
  mobilePhone: string;
  secondaryEmailVisible: boolean;
  mobilePhoneVisible: boolean;
  reason: string;
}>;

export const emptyMemberCreateInviteDraft: MemberCreateInviteDraft = {
  firstName: "",
  lastName: "",
  invitedEmail: "",
  spouseFirstName: "",
  spouseLastName: "",
  teeLocation: "",
  duesPaid: false,
  secondaryEmail: "",
  mobilePhone: "",
  secondaryEmailVisible: false,
  mobilePhoneVisible: false,
  reason: "",
};

/** Exact profile payload sent to create_pending_member_profile. */
export type MemberProfileCreatePayload = Readonly<{
  firstName: string;
  lastName: string;
  spouseFirstName: string | null;
  spouseLastName: string | null;
  teeLocation: TeeLocation | null;
  duesPaid: boolean;
  secondaryEmail: string | null;
  homePhone: null;
  workPhone: null;
  mobilePhone: string | null;
  addressLine1: null;
  addressLine2: null;
  city: null;
  stateRegion: null;
  postalCode: null;
  country: null;
  secondaryEmailVisible: boolean;
  homePhoneVisible: false;
  workPhoneVisible: false;
  mobilePhoneVisible: boolean;
  addressListed: false;
  reason: string | null;
}>;

export type MemberCreateInvitePhase =
  "idle" | "creating" | "ready" | "inviting" | "success" | "error";

export type MemberCreateInviteOperation = "create" | "invite";

export type MemberCreateInviteOperationState = Readonly<{
  fingerprint: string | null;
  operationId: string | null;
}>;

export type MemberCreateInviteRecoveryState = Readonly<{
  draft: MemberCreateInviteDraft;
  createdMembershipId: string | null;
  createOperation: MemberCreateInviteOperationState;
  inviteOperation: MemberCreateInviteOperationState;
}>;

export const memberCreateInviteRecoveryStorageKey =
  "greenroster:member-create-invite:v1";

/** Only coordinators and administrators may author a pending membership. */
export function canCreatePendingMember(role: MemberRole) {
  return role !== "member";
}

export function shouldResetMemberCreateConfirmation(
  createdMembershipId: string | null,
) {
  return createdMembershipId === null;
}

export function buildMemberProfileCreatePayload(
  draft: MemberCreateInviteDraft,
): MemberProfileCreatePayload {
  return {
    firstName: draft.firstName.trim(),
    lastName: draft.lastName.trim(),
    spouseFirstName: nullableText(draft.spouseFirstName),
    spouseLastName: nullableText(draft.spouseLastName),
    teeLocation: draft.teeLocation || null,
    duesPaid: draft.duesPaid,
    secondaryEmail: nullableEmail(draft.secondaryEmail),
    homePhone: null,
    workPhone: null,
    mobilePhone: nullableText(draft.mobilePhone),
    addressLine1: null,
    addressLine2: null,
    city: null,
    stateRegion: null,
    postalCode: null,
    country: null,
    secondaryEmailVisible: draft.secondaryEmailVisible,
    homePhoneVisible: false,
    workPhoneVisible: false,
    mobilePhoneVisible: draft.mobilePhoneVisible,
    addressListed: false,
    reason: nullableText(draft.reason),
  };
}

export function serializeMemberCreateInviteRecovery(
  state: MemberCreateInviteRecoveryState,
) {
  return JSON.stringify(state);
}

export function parseMemberCreateInviteRecovery(
  serialized: string | null,
): MemberCreateInviteRecoveryState | null {
  if (!serialized) return null;
  try {
    const value: unknown = JSON.parse(serialized);
    if (!isRecord(value) || !isDraft(value.draft)) return null;
    if (
      value.createdMembershipId !== null &&
      (typeof value.createdMembershipId !== "string" ||
        !isUuid(value.createdMembershipId))
    ) {
      return null;
    }
    if (
      !isOperationState(value.createOperation) ||
      !isOperationState(value.inviteOperation)
    ) {
      return null;
    }
    return {
      draft: value.draft,
      createdMembershipId: value.createdMembershipId,
      createOperation: value.createOperation,
      inviteOperation: value.inviteOperation,
    };
  } catch {
    return null;
  }
}

export function memberCreateInviteFingerprint(
  operation: MemberCreateInviteOperation,
  payload: unknown,
) {
  return `${operation}:${JSON.stringify(payload)}`;
}

/**
 * Keep the same operation id while retrying the same confirmed request. A
 * changed profile draft gets a fresh id; the invite address is intentionally
 * owned by the separate invitation operation.
 */
export function retainMemberCreateInviteOperationId(
  state: MemberCreateInviteOperationState,
  operation: MemberCreateInviteOperation,
  payload: unknown,
  createId: () => string,
): MemberCreateInviteOperationState {
  const fingerprint = memberCreateInviteFingerprint(operation, payload);
  if (state.fingerprint === fingerprint && state.operationId) {
    return state;
  }
  return { fingerprint, operationId: createId() };
}

function nullableText(value: string) {
  return value.trim() || null;
}

function nullableEmail(value: string) {
  const normalized = value.trim().toLowerCase();
  return normalized || null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isDraft(value: unknown): value is MemberCreateInviteDraft {
  if (!isRecord(value)) return false;
  return (
    typeof value.firstName === "string" &&
    typeof value.lastName === "string" &&
    typeof value.invitedEmail === "string" &&
    typeof value.spouseFirstName === "string" &&
    typeof value.spouseLastName === "string" &&
    (value.teeLocation === "" ||
      value.teeLocation === "pro" ||
      value.teeLocation === "back" ||
      value.teeLocation === "middle" ||
      value.teeLocation === "front") &&
    typeof value.duesPaid === "boolean" &&
    typeof value.secondaryEmail === "string" &&
    typeof value.mobilePhone === "string" &&
    typeof value.secondaryEmailVisible === "boolean" &&
    typeof value.mobilePhoneVisible === "boolean" &&
    typeof value.reason === "string"
  );
}

function isOperationState(
  value: unknown,
): value is MemberCreateInviteOperationState {
  if (!isRecord(value)) return false;
  return (
    (value.fingerprint === null || typeof value.fingerprint === "string") &&
    (value.operationId === null || typeof value.operationId === "string")
  );
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}
