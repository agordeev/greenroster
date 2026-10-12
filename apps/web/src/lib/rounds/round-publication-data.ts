import "server-only";

import {
  roundPublicationMemberRowsSchema,
  roundPublicationReceiptFromRow,
  roundPublicationReceiptRowsSchema,
  roundPublicationReviewFromRows,
  type RoundPublicationInput,
  type RoundPublicationPreviewInput,
  type RoundPublicationReceipt,
  type RoundPublicationReview,
} from "../../domain/round-publication";
import { MutationError, type MutationFieldErrors } from "../mutations/result";
import { createSupabaseServiceClient } from "../supabase/service-client";

type SupabaseRpcError = Readonly<{ code?: string; message?: string }>;

function mapRoundPublicationError(error: SupabaseRpcError): MutationError {
  if (error.code === "P0003")
    return new MutationError("forbidden", { cause: error });
  if (error.code === "P0002")
    return new MutationError("unavailable", { cause: error });
  if (error.code === "P0001")
    return new MutationError("locked", { cause: error });
  if (error.code === "40001")
    return new MutationError("stale_version", { cause: error });
  if (
    error.code === "22003" ||
    error.code === "22004" ||
    error.code === "22023" ||
    error.code === "22P02" ||
    error.code === "23505" ||
    error.code === "23514"
  ) {
    const fieldErrors = publicationFieldErrors(error.message);
    return new MutationError("validation", {
      cause: error,
      ...(fieldErrors ? { fieldErrors } : {}),
    });
  }
  if (!error.code) return new MutationError("transient", { cause: error });
  return new MutationError("unexpected", { cause: error });
}

function publicationFieldErrors(
  message: string | undefined,
): MutationFieldErrors | undefined {
  switch (message) {
    case "round_not_found":
      return {
        roundId: [
          "We couldn't find that round. Refresh the page and try again.",
        ],
      };
    case "round_state_locked":
      return { roundId: ["This round can no longer be published."] };
    case "publication_review_stale":
      return {
        roundId: ["The player list has changed. Refresh and check it again."],
      };
    case "publication_incomplete":
      return {
        roundId: [
          "Add a description, start time, and format before publishing.",
        ],
      };
    case "publication_quota_settings_missing":
      return {
        roundId: [
          "Choose your group's quota rules before you publish a net round.",
        ],
      };
    case "publication_quota_not_ready":
      return {
        roundId: [
          "Every included member needs a quota before you publish a net round.",
        ],
      };
    case "publication_participant_ineligible":
      return {
        roundId: ["Exclude the members who aren't eligible before publishing."],
      };
    case "publication_participant_invalid":
      return {
        excludedMembershipIds: ["Refresh the player list before publishing."],
      };
    default:
      return undefined;
  }
}

export async function executePreviewRoundPublication(
  actorUserId: string,
  input: RoundPublicationPreviewInput,
): Promise<RoundPublicationReview> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase.rpc("preview_round_publication", {
    p_actor_user_id: actorUserId,
    p_round_id: input.roundId,
    p_excluded_membership_ids: input.excludedMembershipIds,
  });
  if (error) throw mapRoundPublicationError(error);

  const rows = roundPublicationMemberRowsSchema.safeParse(data);
  if (!rows.success)
    throw new MutationError("unexpected", { cause: rows.error });
  return roundPublicationReviewFromRows(rows.data);
}

export async function executePublishRound(
  actorUserId: string,
  input: RoundPublicationInput,
  correlationId: string,
): Promise<RoundPublicationReceipt> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase.rpc("publish_round", {
    p_actor_user_id: actorUserId,
    p_round_id: input.roundId,
    p_excluded_membership_ids: input.excludedMembershipIds,
    p_correlation_id: correlationId,
    p_operation_id: input.operationId,
    p_expected_round_version: input.expectedRoundVersion,
    p_review_fingerprint: input.reviewFingerprint,
  });
  if (error) throw mapRoundPublicationError(error);

  const rows = roundPublicationReceiptRowsSchema.safeParse(data);
  if (!rows.success)
    throw new MutationError("unexpected", { cause: rows.error });
  return roundPublicationReceiptFromRow(rows.data[0]);
}
