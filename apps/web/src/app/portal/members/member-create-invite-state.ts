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
  homePhone: string;
  workPhone: string;
  mobilePhone: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  stateRegion: string;
  postalCode: string;
  country: string;
  secondaryEmailVisible: boolean;
  homePhoneVisible: boolean;
  workPhoneVisible: boolean;
  mobilePhoneVisible: boolean;
  addressListed: boolean;
  handicapId: string;
  handicap: string;
  handicapAsOf: string;
  handicapReason: string;
  handicapConfirmed: boolean;
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
  homePhone: "",
  workPhone: "",
  mobilePhone: "",
  addressLine1: "",
  addressLine2: "",
  city: "",
  stateRegion: "",
  postalCode: "",
  country: "",
  secondaryEmailVisible: false,
  homePhoneVisible: false,
  workPhoneVisible: false,
  mobilePhoneVisible: false,
  addressListed: false,
  handicapId: "",
  handicap: "",
  handicapAsOf: "",
  handicapReason: "",
  handicapConfirmed: false,
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
  reason: string | null;
}>;

export type MemberCreateInvitePhase =
  | "idle"
  | "creating"
  | "ready"
  | "inviting"
  | "recording-handicap"
  | "success"
  | "error";

export type MemberCreateInviteOperation = "create" | "invite" | "handicap";

export type MemberCreateInviteOperationState = Readonly<{
  fingerprint: string | null;
  operationId: string | null;
}>;

export type MemberCreateInviteRecoveryState = Readonly<{
  draft: MemberCreateInviteDraft;
  createdMembershipId: string | null;
  createOperation: MemberCreateInviteOperationState;
  inviteOperation: MemberCreateInviteOperationState;
  handicapOperation: MemberCreateInviteOperationState;
}>;

export const memberCreateInviteRecoveryStorageKey =
  "greenroster:member-create-invite:v1";

const emptyMemberCreateInviteOperationState: MemberCreateInviteOperationState =
  {
    fingerprint: null,
    operationId: null,
  };

/** Only coordinators and administrators may author a pending membership. */
export function canCreatePendingMember(role: MemberRole) {
  return role !== "member";
}

export function memberCreateRequiresHandicapBeforeInvite(
  draft: MemberCreateInviteDraft,
  handicapRecorded: boolean,
) {
  const hasHandicapDraft = Boolean(
    draft.handicap.trim() ||
    draft.handicapId.trim() ||
    draft.handicapAsOf.trim() ||
    draft.handicapReason.trim(),
  );
  return hasHandicapDraft && !handicapRecorded;
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
    homePhone: nullableText(draft.homePhone),
    workPhone: nullableText(draft.workPhone),
    mobilePhone: nullableText(draft.mobilePhone),
    addressLine1: nullableText(draft.addressLine1),
    addressLine2: nullableText(draft.addressLine2),
    city: nullableText(draft.city),
    stateRegion: nullableText(draft.stateRegion),
    postalCode: nullableText(draft.postalCode),
    country: nullableText(draft.country),
    secondaryEmailVisible: draft.secondaryEmailVisible,
    homePhoneVisible: draft.homePhoneVisible,
    workPhoneVisible: draft.workPhoneVisible,
    mobilePhoneVisible: draft.mobilePhoneVisible,
    addressListed: draft.addressListed,
    reason: nullableText(draft.reason),
  };
}

/** Exact payload for the separate post-create manual handicap action. */
export type MemberHandicapRecordPayload = Readonly<{
  membershipId: string;
  handicapId: string | null;
  handicap: string;
  asOf: string;
  expectedMembershipVersion: 1;
  confirmed: boolean;
  reason: string;
}>;

export function buildMemberHandicapRecordPayload(
  draft: MemberCreateInviteDraft,
  membershipId: string,
): MemberHandicapRecordPayload {
  return {
    membershipId,
    handicapId: nullableText(draft.handicapId),
    handicap: draft.handicap.trim(),
    asOf: draft.handicapAsOf.trim(),
    expectedMembershipVersion: 1,
    confirmed: draft.handicapConfirmed,
    reason: draft.handicapReason.trim(),
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
      !isOperationState(value.inviteOperation) ||
      !isOperationState(
        value.handicapOperation ?? emptyMemberCreateInviteOperationState,
      )
    ) {
      return null;
    }
    return {
      draft: normalizeDraft(value.draft),
      createdMembershipId: value.createdMembershipId,
      createOperation: value.createOperation,
      inviteOperation: value.inviteOperation,
      handicapOperation: isOperationState(value.handicapOperation)
        ? value.handicapOperation
        : emptyMemberCreateInviteOperationState,
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
    optionalString(value.homePhone) &&
    optionalString(value.workPhone) &&
    typeof value.mobilePhone === "string" &&
    optionalString(value.addressLine1) &&
    optionalString(value.addressLine2) &&
    optionalString(value.city) &&
    optionalString(value.stateRegion) &&
    optionalString(value.postalCode) &&
    optionalString(value.country) &&
    typeof value.secondaryEmailVisible === "boolean" &&
    optionalBoolean(value.homePhoneVisible) &&
    optionalBoolean(value.workPhoneVisible) &&
    typeof value.mobilePhoneVisible === "boolean" &&
    optionalBoolean(value.addressListed) &&
    optionalString(value.handicapId) &&
    optionalString(value.handicap) &&
    optionalString(value.handicapAsOf) &&
    optionalString(value.handicapReason) &&
    optionalBoolean(value.handicapConfirmed) &&
    typeof value.reason === "string"
  );
}

function normalizeDraft(
  value: MemberCreateInviteDraft,
): MemberCreateInviteDraft {
  return {
    ...emptyMemberCreateInviteDraft,
    ...value,
    homePhone: value.homePhone ?? "",
    workPhone: value.workPhone ?? "",
    addressLine1: value.addressLine1 ?? "",
    addressLine2: value.addressLine2 ?? "",
    city: value.city ?? "",
    stateRegion: value.stateRegion ?? "",
    postalCode: value.postalCode ?? "",
    country: value.country ?? "",
    homePhoneVisible: value.homePhoneVisible ?? false,
    workPhoneVisible: value.workPhoneVisible ?? false,
    addressListed: value.addressListed ?? false,
    handicapId: value.handicapId ?? "",
    handicap: value.handicap ?? "",
    handicapAsOf: value.handicapAsOf ?? "",
    handicapReason: value.handicapReason ?? "",
    handicapConfirmed: value.handicapConfirmed ?? false,
  };
}

function optionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === "string";
}

function optionalBoolean(value: unknown): value is boolean | undefined {
  return value === undefined || typeof value === "boolean";
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
