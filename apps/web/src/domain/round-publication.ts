import { z } from "zod";

const decimalSchema = z
  .union([z.string(), z.number()])
  .transform((value) => String(value).trim());

const nullableDecimalSchema = decimalSchema.nullable();
const nullableDateSchema = z.iso.date().nullable();

/**
 * The publication RPC returns one row for each active member considered for
 * the round.  This is deliberately a closed schema: the server adapter must
 * fail closed if the database projection changes shape.
 */
export const roundPublicationMemberRowSchema = z
  .object({
    round_id: z.uuid(),
    format: z.enum(["individual_net", "individual_gross"]),
    review_version: z
      .union([z.number().int().positive(), z.string().regex(/^\d+$/u)])
      .transform(Number)
      .refine(Number.isSafeInteger),
    review_fingerprint: z.string().regex(/^[0-9a-f]{64}$/u),
    membership_id: z.uuid(),
    group_id: z.uuid(),
    first_name: z.string().nullable(),
    last_name: z.string().nullable(),
    eligibility_state: z.enum(["eligible", "ineligible", "excluded"]),
    ineligibility_reason: z.string().nullable(),
    included: z.boolean(),
    projection_ready: z.boolean(),
    projected_quota: nullableDecimalSchema,
    quota_snapshot_source: z.record(z.string(), z.unknown()).nullable(),
    handicap_snapshot: nullableDecimalSchema,
    handicap_snapshot_source: z.enum(["manual", "import"]).nullable(),
    handicap_snapshot_as_of: nullableDateSchema,
    tee_snapshot: z.enum(["pro", "back", "middle", "front"]).nullable(),
    email_ready: z.boolean(),
  })
  .strict();

export const roundPublicationMemberRowsSchema = z.array(
  roundPublicationMemberRowSchema,
);

export const roundPublicationPreviewInputSchema = z
  .object({
    roundId: z.uuid(),
    excludedMembershipIds: z.array(z.uuid()).max(10_000),
  })
  .strict();

export const roundPublicationInputSchema = z
  .object({
    roundId: z.uuid(),
    excludedMembershipIds: z.array(z.uuid()).max(10_000),
    operationId: z.uuid(),
    expectedRoundVersion: z.number().int().positive(),
    reviewFingerprint: z.string().regex(/^[0-9a-f]{64}$/u),
  })
  .strict();

const publicationReceiptRowSchema = z
  .object({
    round_id: z.uuid(),
    group_id: z.uuid(),
    state: z.enum(["published"]),
    version: z
      .union([z.number().int().positive(), z.string().regex(/^\d+$/u)])
      .transform(Number)
      .refine(Number.isSafeInteger),
    published_at: z.string().datetime({ offset: true }),
    participant_count: z.number().int().nonnegative(),
    notification_count: z.number().int().nonnegative(),
  })
  .strict();

export const roundPublicationReceiptRowsSchema = z
  .array(publicationReceiptRowSchema)
  .length(1);

export type RoundPublicationPreviewInput = z.infer<
  typeof roundPublicationPreviewInputSchema
>;
export type RoundPublicationInput = z.infer<typeof roundPublicationInputSchema>;

export type RoundPublicationMember = Readonly<{
  membershipId: string;
  roundVersion: number;
  reviewFingerprint: string;
  groupId: string;
  firstName: string;
  lastName: string;
  eligibilityState: "eligible" | "ineligible" | "excluded";
  eligibilityReason: string | null;
  included: boolean;
  projectionReady: boolean;
  projectedQuota: string | null;
  quotaSnapshotSource: Readonly<Record<string, unknown>> | null;
  handicapSnapshot: string | null;
  handicapSnapshotSource: "manual" | "import" | null;
  handicapSnapshotAsOf: string | null;
  teeSnapshot: "pro" | "back" | "middle" | "front" | null;
  emailReady: boolean;
}>;

export type RoundPublicationSummary = Readonly<{
  activeMemberCount: number;
  includedMemberCount: number;
  noResponseCount: number;
  ineligibleCount: number;
  excludedCount: number;
  missingQuotaCount: number;
  notificationRecipientCount: number;
}>;

export type RoundPublicationReview = Readonly<{
  members: readonly RoundPublicationMember[];
  format: "individual_net" | "individual_gross";
  roundVersion: number;
  reviewFingerprint: string;
  summary: RoundPublicationSummary;
}>;

export type RoundPublicationReceipt = Readonly<{
  roundId: string;
  groupId: string;
  state: "published";
  version: number;
  publishedAt: string;
  participantCount: number;
  notificationCount: number;
}>;

export function roundPublicationMemberFromRow(
  row: z.infer<typeof roundPublicationMemberRowSchema>,
): RoundPublicationMember {
  return {
    membershipId: row.membership_id,
    groupId: row.group_id,
    roundVersion: row.review_version,
    reviewFingerprint: row.review_fingerprint,
    firstName: row.first_name ?? "",
    lastName: row.last_name ?? "",
    eligibilityState: row.eligibility_state,
    eligibilityReason: row.ineligibility_reason,
    included: row.included,
    projectionReady: row.projection_ready,
    projectedQuota: row.projected_quota,
    quotaSnapshotSource: row.quota_snapshot_source,
    handicapSnapshot: row.handicap_snapshot,
    handicapSnapshotSource: row.handicap_snapshot_source,
    handicapSnapshotAsOf: row.handicap_snapshot_as_of,
    teeSnapshot: row.tee_snapshot,
    emailReady: row.email_ready,
  };
}

export function summarizeRoundPublication(
  members: readonly RoundPublicationMember[],
  format: "individual_net" | "individual_gross",
): RoundPublicationSummary {
  const includedMembers = members.filter(
    (member) => member.included && member.eligibilityState === "eligible",
  );
  const ineligibleMembers = members.filter(
    (member) => member.eligibilityState === "ineligible",
  );
  const excludedMembers = members.filter(
    (member) => member.eligibilityState === "excluded",
  );
  const missingQuotaMembers = members.filter(
    (member) =>
      format === "individual_net" &&
      !member.projectionReady &&
      member.eligibilityState !== "excluded" &&
      (member.included || member.eligibilityReason === "quota_not_ready"),
  );
  const notificationRecipients = includedMembers.filter(
    (member) => member.emailReady,
  );

  return {
    activeMemberCount: members.length,
    includedMemberCount: includedMembers.length,
    // A publication creates every included member as No response.  The
    // member's later RSVP is a separate Phase 04 mutation.
    noResponseCount: includedMembers.length,
    ineligibleCount: ineligibleMembers.length,
    excludedCount: excludedMembers.length,
    missingQuotaCount: missingQuotaMembers.length,
    notificationRecipientCount: notificationRecipients.length,
  };
}

export function roundPublicationReviewFromRows(
  rows: readonly z.infer<typeof roundPublicationMemberRowSchema>[],
): RoundPublicationReview {
  const members = rows.map(roundPublicationMemberFromRow);
  const firstRow = rows[0];
  if (!firstRow) {
    throw new Error("publication review returned no members");
  }
  if (!rows.every((row) => row.format === firstRow.format)) {
    throw new Error("publication review returned mixed formats");
  }
  return {
    members,
    format: firstRow.format,
    roundVersion: firstRow.review_version,
    reviewFingerprint: firstRow.review_fingerprint,
    summary: summarizeRoundPublication(members, firstRow.format),
  };
}

export function roundPublicationReceiptFromRow(
  row: z.infer<typeof publicationReceiptRowSchema>,
): RoundPublicationReceipt {
  return {
    roundId: row.round_id,
    groupId: row.group_id,
    state: row.state,
    version: row.version,
    publishedAt: row.published_at,
    participantCount: row.participant_count,
    notificationCount: row.notification_count,
  };
}

export function publicationMemberName(member: RoundPublicationMember): string {
  return `${member.firstName} ${member.lastName}`.trim() || "Unnamed member";
}

export function roundPublicationReviewKey(
  review: Pick<RoundPublicationReview, "roundVersion" | "reviewFingerprint">,
): string {
  return `${review.roundVersion}:${review.reviewFingerprint}`;
}
