"use server";

import { headers } from "next/headers";

import { verifyMutationSession } from "@/lib/auth/verify-mutation-session";
import {
  runCreateRoundDraftMutation,
  runUpdateRoundDraftMutation,
} from "@/lib/rounds/round-drafts";
import {
  executeCreateRoundDraft,
  executeUpdateRoundDraft,
} from "@/lib/rounds/round-drafts-data";

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
