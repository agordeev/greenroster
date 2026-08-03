"use server";

import { headers } from "next/headers";

import { verifyMutationSession } from "@/lib/auth/verify-mutation-session";
import {
  runRoundPublicationMutation,
  runRoundPublicationPreview,
} from "@/lib/rounds/round-publication";
import {
  runCreateRoundDraftMutation,
  runUpdateRoundDraftMutation,
} from "@/lib/rounds/round-drafts";
import { runRoundCancellationMutation } from "@/domain/round-cancellation";
import { runRoundRsvpMutation } from "@/domain/round-rsvp";
import {
  executeCreateRoundDraft,
  executeUpdateRoundDraft,
} from "@/lib/rounds/round-drafts-data";
import { executeCancelRound } from "@/lib/rounds/round-cancellation-data";
import { executeSetRoundRsvp } from "@/lib/rounds/round-rsvp-data";
import {
  executePreviewRoundPublication,
  executePublishRound,
} from "@/lib/rounds/round-publication-data";
import {
  runPreviewPublishedRoundEdit,
  runUpdatePublishedRoundEdit,
} from "@/domain/published-round-edit";
import { runRoundScoringMutation } from "@/domain/round-scoring";
import {
  executePreviewPublishedRoundEdit,
  executeUpdatePublishedRoundEdit,
} from "@/lib/rounds/published-round-edit-data";
import { executeOpenRoundScoring } from "@/lib/rounds/round-scoring-data";

export async function createRoundDraftAction(input: unknown) {
  const requestHeaders = await headers();
  return runCreateRoundDraftMutation(
    input,
    requestHeaders.get("x-correlation-id"),
    {
      execute: executeCreateRoundDraft,
      verifySession: verifyMutationSession,
    },
  );
}

export async function updateRoundDraftAction(input: unknown) {
  const requestHeaders = await headers();
  return runUpdateRoundDraftMutation(
    input,
    requestHeaders.get("x-correlation-id"),
    {
      execute: executeUpdateRoundDraft,
      verifySession: verifyMutationSession,
    },
  );
}

export async function previewRoundPublicationAction(input: unknown) {
  const requestHeaders = await headers();
  return runRoundPublicationPreview(
    input,
    requestHeaders.get("x-correlation-id"),
    {
      verifySession: verifyMutationSession,
      execute: async (actorUserId, previewInput) => {
        return executePreviewRoundPublication(actorUserId, previewInput);
      },
    },
  );
}

export async function publishRoundAction(input: unknown) {
  const requestHeaders = await headers();
  return runRoundPublicationMutation(
    input,
    requestHeaders.get("x-correlation-id"),
    {
      execute: executePublishRound,
      verifySession: verifyMutationSession,
    },
  );
}

export async function cancelRoundAction(input: unknown) {
  const requestHeaders = await headers();
  return runRoundCancellationMutation(
    input,
    requestHeaders.get("x-correlation-id"),
    {
      execute: executeCancelRound,
      verifySession: verifyMutationSession,
    },
  );
}

export async function previewPublishedRoundEditAction(input: unknown) {
  const requestHeaders = await headers();
  return runPreviewPublishedRoundEdit(
    input,
    requestHeaders.get("x-correlation-id"),
    {
      execute: executePreviewPublishedRoundEdit,
      verifySession: verifyMutationSession,
    },
  );
}

export async function updatePublishedRoundEditAction(input: unknown) {
  const requestHeaders = await headers();
  return runUpdatePublishedRoundEdit(
    input,
    requestHeaders.get("x-correlation-id"),
    {
      execute: executeUpdatePublishedRoundEdit,
      verifySession: verifyMutationSession,
    },
  );
}

export const applyPublishedRoundEditAction = updatePublishedRoundEditAction;

export async function openRoundScoringAction(input: unknown) {
  const requestHeaders = await headers();
  return runRoundScoringMutation(
    input,
    requestHeaders.get("x-correlation-id"),
    {
      execute: executeOpenRoundScoring,
      verifySession: verifyMutationSession,
    },
  );
}

export async function setRoundRsvpAction(input: unknown) {
  const requestHeaders = await headers();
  return runRoundRsvpMutation(input, requestHeaders.get("x-correlation-id"), {
    source: "member_web",
    execute: executeSetRoundRsvp,
    verifySession: verifyMutationSession,
  });
}
