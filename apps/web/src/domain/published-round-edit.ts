import { z } from "zod";

import type { VerifiedMutationSession } from "../lib/auth/verify-mutation-session";
import { runVerifiedMutation } from "../lib/mutations/run-verified-mutation";
import {
  MutationError,
  mutationFailure,
  type MutationResult,
} from "../lib/mutations/result";
import { resolveCorrelationId } from "../lib/mutations/correlation";
import { isLocalDateTimeOrBlank, roundStates } from "./round-drafts";

const uuidSchema = z.uuid();
const localDateTimeSchema = z
  .string()
  .trim()
  .refine(isLocalDateTimeOrBlank, "Enter a valid local date and time.");
const roundUrlSchema = z
  .string()
  .trim()
  .refine(
    (value) =>
      value === "" || /^https:\/\/[^/?#\s]+(?:[/?#][^\s]*)?$/u.test(value),
    "Use an https:// URL.",
  );

const sharedPublishedRoundEditInput = {
  roundId: uuidSchema,
  description: z.string().trim(),
  scheduledLocal: localDateTimeSchema,
  venue: z.string().trim(),
  roundUrl: roundUrlSchema,
  notes: z.string().trim().max(500, "Keep notes to 500 characters or fewer."),
  notesVisibleToPlayers: z.boolean(),
  rsvpDeadlineLocal: localDateTimeSchema,
  expectedRoundVersion: z.number().int().positive(),
} as const;

export const previewPublishedRoundEditInputSchema = z
  .object(sharedPublishedRoundEditInput)
  .strict();

export const updatePublishedRoundEditInputSchema = z
  .object({
    ...sharedPublishedRoundEditInput,
    impactFingerprint: z.string().regex(/^[0-9a-f]{64}$/u),
    announce: z.boolean(),
    operationId: uuidSchema,
  })
  .strict();

// These aliases keep the names discoverable alongside the RPC names while
// leaving the preview/apply payloads closed and distinct.
export const publishedRoundEditPreviewInputSchema =
  previewPublishedRoundEditInputSchema;
export const publishedRoundEditInputSchema =
  updatePublishedRoundEditInputSchema;
export const applyPublishedRoundEditInputSchema =
  updatePublishedRoundEditInputSchema;

export type PreviewPublishedRoundEditInput = z.infer<
  typeof previewPublishedRoundEditInputSchema
>;
export type UpdatePublishedRoundEditInput = z.infer<
  typeof updatePublishedRoundEditInputSchema
>;
export type PublishedRoundEditPreviewInput = PreviewPublishedRoundEditInput;
export type PublishedRoundEditInput = UpdatePublishedRoundEditInput;

export const publishedRoundEditFieldKeys = [
  "description",
  "scheduled_at",
  "venue",
  "round_url",
  "notes",
  "notes_visible_to_players",
  "rsvp_deadline_at",
] as const;
export type PublishedRoundEditField =
  (typeof publishedRoundEditFieldKeys)[number];

const materialCategorySchema = z.string().trim().min(1).max(100);
const fingerprintSchema = z.string().regex(/^[0-9a-f]{64}$/u);
const instantSchema = z.string().datetime({ offset: true }).nullable();
const httpsUrlNullableSchema = z
  .string()
  .regex(/^https:\/\/[^/?#\s]+(?:[/?#][^\s]*)?$/u)
  .nullable();
const positiveIntegerSchema = z
  .union([z.number().int().positive(), z.string().regex(/^\d+$/u)])
  .transform((value) => Number(value))
  .refine(Number.isSafeInteger, "Invalid positive integer.");
const nonNegativeIntegerSchema = z
  .union([z.number().int().nonnegative(), z.string().regex(/^\d+$/u)])
  .transform((value) => Number(value))
  .refine(Number.isSafeInteger, "Invalid non-negative integer.");

export const publishedRoundEditRoundSchema = z
  .object({
    round_id: uuidSchema,
    group_id: uuidSchema,
    description: z.string().nullable(),
    scheduled_at: instantSchema,
    group_time_zone: z.string().min(1),
    venue: z.string().nullable(),
    round_url: httpsUrlNullableSchema,
    notes: z.string().max(500).nullable(),
    notes_visible_to_players: z.boolean(),
    rsvp_deadline_at: instantSchema,
    format: z.enum(["individual_net", "individual_gross"]),
    state: z.enum(roundStates),
    version: positiveIntegerSchema,
  })
  .strict();

export const publishedRoundEditAffectedParticipantSchema = z
  .object({
    participant_id: uuidSchema,
    membership_id: uuidSchema,
    first_name: z.string().nullable(),
    last_name: z.string().nullable(),
    rsvp_status: z.enum(["no_response", "playing", "not_playing"]),
  })
  .strict();

const publishedRoundEditImpactFields = {
  current: publishedRoundEditRoundSchema,
  proposed: publishedRoundEditRoundSchema,
  current_version: positiveIntegerSchema,
  changed_fields: z.array(z.string().trim().min(1).max(100)),
  material_categories: z.array(materialCategorySchema),
  affected_participants: z.array(publishedRoundEditAffectedParticipantSchema),
  affected_participant_count: nonNegativeIntegerSchema,
  scoring_consequences: z.array(z.string().trim().min(1).max(500)),
  impact_fingerprint: fingerprintSchema,
} as const;

export const publishedRoundEditPreviewEnvelopeSchema = z
  .object(publishedRoundEditImpactFields)
  .strict();

export const publishedRoundEditReceiptEnvelopeSchema = z
  .object({
    ...publishedRoundEditImpactFields,
    announce: z.boolean(),
    notification_count: nonNegativeIntegerSchema,
  })
  .strict();

export type PublishedRoundEditRound = Readonly<{
  roundId: string;
  groupId: string;
  description: string | null;
  scheduledAt: string | null;
  groupTimeZone: string;
  venue: string | null;
  roundUrl: string | null;
  notes: string | null;
  notesVisibleToPlayers: boolean;
  rsvpDeadlineAt: string | null;
  format: "individual_net" | "individual_gross";
  state: (typeof roundStates)[number];
  version: number;
}>;

export type PublishedRoundEditAffectedParticipant = Readonly<{
  participantId: string;
  membershipId: string;
  firstName: string | null;
  lastName: string | null;
  rsvpStatus: "no_response" | "playing" | "not_playing";
}>;

export type PublishedRoundEditImpact = Readonly<{
  current: PublishedRoundEditRound;
  proposed: PublishedRoundEditRound;
  currentVersion: number;
  changedFields: readonly string[];
  materialCategories: readonly string[];
  affectedParticipants: readonly PublishedRoundEditAffectedParticipant[];
  affectedParticipantCount: number;
  scoringConsequences: readonly string[];
  impactFingerprint: string;
}>;

export type PublishedRoundEditReceipt = Readonly<
  PublishedRoundEditImpact & {
    announce: boolean;
    notificationCount: number;
  }
>;

export type PublishedRoundEditPreview = PublishedRoundEditImpact;

export function publishedRoundEditImpactFromRow(
  row: z.infer<typeof publishedRoundEditPreviewEnvelopeSchema>,
): PublishedRoundEditImpact {
  return {
    current: roundFromRow(row.current),
    proposed: roundFromRow(row.proposed),
    currentVersion: row.current_version,
    changedFields: row.changed_fields,
    materialCategories: row.material_categories,
    affectedParticipants: row.affected_participants.map((participant) => ({
      participantId: participant.participant_id,
      membershipId: participant.membership_id,
      firstName: participant.first_name,
      lastName: participant.last_name,
      rsvpStatus: participant.rsvp_status,
    })),
    affectedParticipantCount: row.affected_participant_count,
    scoringConsequences: row.scoring_consequences,
    impactFingerprint: row.impact_fingerprint,
  };
}

export function publishedRoundEditReceiptFromRow(
  row: z.infer<typeof publishedRoundEditReceiptEnvelopeSchema>,
): PublishedRoundEditReceipt {
  return {
    ...publishedRoundEditImpactFromRow(row),
    announce: row.announce,
    notificationCount: row.notification_count,
  };
}

export type PublishedRoundEditPreviewDependencies = Readonly<{
  execute: (
    actorUserId: string,
    input: PreviewPublishedRoundEditInput,
  ) => Promise<PublishedRoundEditPreview>;
  verifySession: () => Promise<VerifiedMutationSession>;
}>;

export type PublishedRoundEditMutationDependencies = Readonly<{
  execute: (
    actorUserId: string,
    input: UpdatePublishedRoundEditInput,
    correlationId: string,
  ) => Promise<PublishedRoundEditReceipt>;
  verifySession: () => Promise<VerifiedMutationSession>;
}>;

export async function runPreviewPublishedRoundEdit(
  rawInput: unknown,
  correlationCandidate: string | null | undefined,
  dependencies: PublishedRoundEditPreviewDependencies,
): Promise<MutationResult<PublishedRoundEditPreview>> {
  const correlationId = resolveCorrelationId(correlationCandidate);
  try {
    const session = await dependencies.verifySession();
    const parsedInput =
      previewPublishedRoundEditInputSchema.safeParse(rawInput);
    if (!parsedInput.success) {
      throw new MutationError("validation", {
        fieldErrors: fieldErrors(parsedInput.error.issues),
      });
    }
    const data = await dependencies.execute(session.userId, parsedInput.data);
    return { ok: true, data, correlationId };
  } catch (error) {
    return mutationFailure(error, correlationId);
  }
}

export async function runUpdatePublishedRoundEdit(
  rawInput: unknown,
  correlationCandidate: string | null | undefined,
  dependencies: PublishedRoundEditMutationDependencies,
): Promise<MutationResult<PublishedRoundEditReceipt>> {
  return runVerifiedMutation(rawInput, correlationCandidate, {
    execute: dependencies.execute,
    inputSchema: updatePublishedRoundEditInputSchema,
    verifySession: dependencies.verifySession,
  });
}

export const runPublishedRoundEditPreview = runPreviewPublishedRoundEdit;
export const runPublishedRoundEditMutation = runUpdatePublishedRoundEdit;
export const runPreviewPublishedRoundEditMutation =
  runPreviewPublishedRoundEdit;
export const runApplyPublishedRoundEditMutation = runUpdatePublishedRoundEdit;

function roundFromRow(
  row: z.infer<typeof publishedRoundEditRoundSchema>,
): PublishedRoundEditRound {
  return {
    roundId: row.round_id,
    groupId: row.group_id,
    description: row.description,
    scheduledAt: row.scheduled_at,
    groupTimeZone: row.group_time_zone,
    venue: row.venue,
    roundUrl: row.round_url,
    notes: row.notes,
    notesVisibleToPlayers: row.notes_visible_to_players,
    rsvpDeadlineAt: row.rsvp_deadline_at,
    format: row.format,
    state: row.state,
    version: row.version,
  };
}

function fieldErrors(
  issues: readonly { path: readonly PropertyKey[]; message: string }[],
) {
  const errors: Record<string, string[]> = {};
  for (const issue of issues) {
    const field = issue.path[0];
    if (typeof field === "string") (errors[field] ??= []).push(issue.message);
  }
  return errors;
}
