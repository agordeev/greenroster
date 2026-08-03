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
import {
  executeCreateRoundDraft,
  executeUpdateRoundDraft,
} from "@/lib/rounds/round-drafts-data";
import {
  executePreviewRoundPublication,
  executePublishRound,
} from "@/lib/rounds/round-publication-data";

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
