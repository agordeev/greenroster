import type { MemberQuotaBootstrapInput } from "@/lib/memberships/member-quota-bootstrap";

export const MAX_MEMBER_QUOTA_SEEDS = 20;

export type MemberQuotaEditorDraft = Readonly<{
  initialQuota: string;
  useInitialQuota: boolean;
  seedTotals: readonly string[];
  reason: string;
}>;

export type MemberQuotaEditorOperationState = Readonly<{
  fingerprint: string | null;
  operationId: string | null;
}>;

export type MemberQuotaEditorRecoveryState = Readonly<{
  membershipId: string;
  draft: MemberQuotaEditorDraft;
  operation: MemberQuotaEditorOperationState;
  message: string | null;
  restoreDraft: boolean;
}>;

export const memberQuotaEditorRecoveryStorageKey =
  "greenroster:member-quota-editor:v1";

export function memberQuotaEditorRecoveryStorageKeyForMembership(
  membershipId: string,
) {
  return `${memberQuotaEditorRecoveryStorageKey}:${membershipId}`;
}

/**
 * Only values sent to the protected mutation belong in the idempotency
 * fingerprint. Confirmation is a local safety gate and never changes the
 * server operation identity.
 */
export function memberQuotaBootstrapFingerprint(
  input: Readonly<
    Pick<
      MemberQuotaBootstrapInput,
      | "expectedProjectionVersion"
      | "expectedSettingsVersion"
      | "initialQuota"
      | "membershipId"
      | "reason"
      | "seedTotals"
      | "useInitialQuota"
    >
  >,
) {
  return JSON.stringify({
    expectedProjectionVersion: input.expectedProjectionVersion,
    expectedSettingsVersion: input.expectedSettingsVersion,
    initialQuota: normalizeInitialQuota(input.initialQuota),
    membershipId: input.membershipId,
    reason: input.reason.trim(),
    seedTotals: input.seedTotals
      .map((value) => value.trim())
      .filter((value) => value.length > 0),
    useInitialQuota:
      normalizeInitialQuota(input.initialQuota) === null
        ? false
        : input.useInitialQuota,
  });
}

/**
 * Keep one operation id for an unchanged confirmed request. A changed
 * payload receives a fresh id so the database idempotency record cannot
 * replay an earlier member configuration.
 */
export function retainMemberQuotaBootstrapOperationId(
  state: MemberQuotaEditorOperationState,
  input: Readonly<
    Pick<
      MemberQuotaBootstrapInput,
      | "expectedProjectionVersion"
      | "expectedSettingsVersion"
      | "initialQuota"
      | "membershipId"
      | "reason"
      | "seedTotals"
      | "useInitialQuota"
    >
  >,
  createId: () => string,
): MemberQuotaEditorOperationState {
  const fingerprint = memberQuotaBootstrapFingerprint(input);
  if (state.fingerprint === fingerprint && state.operationId) {
    return state;
  }
  return { fingerprint, operationId: createId() };
}

export function validateMemberQuotaEditorDraft(
  draft: MemberQuotaEditorDraft,
  confirmed: boolean,
) {
  const initialQuota = draft.initialQuota.trim();
  if (draft.useInitialQuota && initialQuota.length === 0) {
    return "Enter a starting quota before you select “Use this starting quota until enough history builds up.”";
  }
  if (draft.seedTotals.length > MAX_MEMBER_QUOTA_SEEDS) {
    return `Enter no more than ${MAX_MEMBER_QUOTA_SEEDS} seed totals.`;
  }
  const trimmedSeeds = draft.seedTotals.map((value) => value.trim());
  const hasGap = trimmedSeeds.some(
    (value, index) =>
      value.length === 0 && trimmedSeeds.slice(index + 1).some(Boolean),
  );
  if (hasGap) {
    return "Complete each seed total or remove the empty row.";
  }
  if (draft.reason.trim().length === 0) {
    return "Add a reason for this change.";
  }
  if (!confirmed) {
    return "Confirm the starting quota change before saving.";
  }
  return null;
}

export function memberQuotaEditorDraftFingerprint(
  draft: MemberQuotaEditorDraft,
  confirmed: boolean,
) {
  return JSON.stringify({
    confirmed,
    initialQuota: draft.initialQuota.trim() || null,
    reason: draft.reason.trim(),
    seedTotals: draft.seedTotals
      .map((value) => value.trim())
      .filter((value) => value.length > 0),
    useInitialQuota:
      draft.initialQuota.trim().length > 0 && draft.useInitialQuota,
  });
}

/**
 * Supplying an initial quota freezes it by default. A later explicit checkbox
 * choice is retained when the value is edited again; an empty value cannot be
 * frozen.
 */
export function resolveMemberQuotaUseInitialQuota(
  initialQuota: string,
  explicitChoice: boolean | null,
) {
  if (initialQuota.trim().length === 0) return false;
  return explicitChoice ?? true;
}

export function serializeMemberQuotaEditorRecovery(
  state: MemberQuotaEditorRecoveryState,
) {
  return JSON.stringify(state);
}

export function parseMemberQuotaEditorRecovery(
  serialized: string | null,
): MemberQuotaEditorRecoveryState | null {
  if (!serialized) return null;
  try {
    const value: unknown = JSON.parse(serialized);
    if (!isRecord(value)) return null;
    if (typeof value.membershipId !== "string" || !isUuid(value.membershipId)) {
      return null;
    }
    if (!isDraft(value.draft) || !isOperationState(value.operation)) {
      return null;
    }
    if (value.message !== null && typeof value.message !== "string") {
      return null;
    }
    if (typeof value.restoreDraft !== "boolean") {
      return null;
    }
    return {
      membershipId: value.membershipId,
      draft: value.draft,
      operation: value.operation,
      message: value.message,
      restoreDraft: value.restoreDraft,
    };
  } catch {
    return null;
  }
}

export function memberQuotaEditorInput(
  membershipId: string,
  expectedProjectionVersion: number,
  expectedSettingsVersion: number,
  draft: MemberQuotaEditorDraft,
  operationId: string,
): Omit<MemberQuotaBootstrapInput, "operationId"> & {
  operationId: string;
} {
  const initialQuota = normalizeInitialQuota(draft.initialQuota);
  return {
    confirmed: true as const,
    expectedProjectionVersion,
    expectedSettingsVersion,
    initialQuota,
    membershipId,
    operationId,
    reason: draft.reason.trim(),
    seedTotals: draft.seedTotals
      .map((value) => value.trim())
      .filter((value) => value.length > 0),
    useInitialQuota: initialQuota === null ? false : draft.useInitialQuota,
  };
}

function normalizeInitialQuota(value: string | null) {
  if (value === null) return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isDraft(value: unknown): value is MemberQuotaEditorDraft {
  if (!isRecord(value) || !Array.isArray(value.seedTotals)) return false;
  return (
    typeof value.initialQuota === "string" &&
    typeof value.useInitialQuota === "boolean" &&
    value.seedTotals.length <= MAX_MEMBER_QUOTA_SEEDS &&
    value.seedTotals.every((seed) => typeof seed === "string") &&
    typeof value.reason === "string"
  );
}

function isOperationState(
  value: unknown,
): value is MemberQuotaEditorOperationState {
  if (!isRecord(value)) return false;
  return (
    (value.fingerprint === null || typeof value.fingerprint === "string") &&
    (value.operationId === null ||
      (typeof value.operationId === "string" && isUuid(value.operationId)))
  );
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}
