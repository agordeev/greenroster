import "server-only";

import {
  publishedRoundEditImpactFromRow,
  publishedRoundEditPreviewEnvelopeSchema,
  publishedRoundEditReceiptFromRow,
  publishedRoundEditReceiptEnvelopeSchema,
  type PreviewPublishedRoundEditInput,
  type PublishedRoundEditPreview,
  type PublishedRoundEditReceipt,
  type UpdatePublishedRoundEditInput,
} from "../../domain/published-round-edit";
import { MutationError, type MutationFieldErrors } from "../mutations/result";
import { createSupabaseServiceClient } from "../supabase/service-client";

type SupabaseRpcError = Readonly<{ code?: string; message?: string }>;

function mapPublishedRoundEditError(error: SupabaseRpcError): MutationError {
  if (error.code === "P0003") {
    return new MutationError("forbidden", { cause: error });
  }
  if (error.code === "P0002") {
    return new MutationError("unavailable", { cause: error });
  }
  if (error.code === "P0001") {
    return new MutationError("locked", { cause: error });
  }
  if (error.code === "40001") {
    return new MutationError("stale_version", { cause: error });
  }
  if (error.code === "22023") {
    const fieldErrors = publishedRoundEditFieldErrors(error.message);
    return new MutationError("validation", {
      cause: error,
      ...(fieldErrors ? { fieldErrors } : {}),
    });
  }
  if (error.code === "23505") {
    return new MutationError("operation_reused", { cause: error });
  }
  if (!error.code) {
    return new MutationError("transient", { cause: error });
  }
  return new MutationError("unexpected", { cause: error });
}

function publishedRoundEditFieldErrors(
  message: string | undefined,
): MutationFieldErrors | undefined {
  switch (message) {
    case "round_description_invalid":
      return { description: ["Add a description for this round."] };
    case "round_scheduled_at_invalid":
      return { scheduledLocal: ["Enter a valid date and time."] };
    case "round_rsvp_deadline_invalid":
      return {
        rsvpDeadlineLocal: [
          "Enter an RSVP deadline before the scheduled round time.",
        ],
      };
    case "round_url_invalid":
      return { roundUrl: ["Use an https:// URL."] };
    case "round_notes_invalid":
      return { notes: ["Notes must be 500 characters or fewer."] };
    case "round_not_found":
    case "round_state_locked":
    case "round_version_changed":
      return { roundId: ["Refresh the selected round before editing."] };
    default:
      return undefined;
  }
}

export async function executePreviewPublishedRoundEdit(
  actorUserId: string,
  input: PreviewPublishedRoundEditInput,
): Promise<PublishedRoundEditPreview> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase.rpc("preview_published_round_edit", {
    p_actor_user_id: actorUserId,
    p_round_id: input.roundId,
    p_description: input.description,
    p_scheduled_local: input.scheduledLocal,
    p_venue: input.venue,
    p_round_url: input.roundUrl,
    p_notes: input.notes,
    p_notes_visible_to_players: input.notesVisibleToPlayers,
    p_rsvp_deadline_local: input.rsvpDeadlineLocal,
    p_expected_round_version: input.expectedRoundVersion,
  });
  if (error) throw mapPublishedRoundEditError(error);

  const parsed = publishedRoundEditPreviewEnvelopeSchema.safeParse(data);
  if (!parsed.success) {
    throw new MutationError("unexpected", { cause: parsed.error });
  }
  return publishedRoundEditImpactFromRow(parsed.data);
}

export async function executeUpdatePublishedRoundEdit(
  actorUserId: string,
  input: UpdatePublishedRoundEditInput,
  correlationId: string,
): Promise<PublishedRoundEditReceipt> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase.rpc("update_published_round_edit", {
    p_actor_user_id: actorUserId,
    p_round_id: input.roundId,
    p_description: input.description,
    p_scheduled_local: input.scheduledLocal,
    p_venue: input.venue,
    p_round_url: input.roundUrl,
    p_notes: input.notes,
    p_notes_visible_to_players: input.notesVisibleToPlayers,
    p_rsvp_deadline_local: input.rsvpDeadlineLocal,
    p_expected_round_version: input.expectedRoundVersion,
    p_impact_fingerprint: input.impactFingerprint,
    p_announce: input.announce,
    p_correlation_id: correlationId,
    p_operation_id: input.operationId,
  });
  if (error) throw mapPublishedRoundEditError(error);

  const parsed = publishedRoundEditReceiptEnvelopeSchema.safeParse(data);
  if (!parsed.success) {
    throw new MutationError("unexpected", { cause: parsed.error });
  }
  return publishedRoundEditReceiptFromRow(parsed.data);
}

export const executeApplyPublishedRoundEdit = executeUpdatePublishedRoundEdit;
