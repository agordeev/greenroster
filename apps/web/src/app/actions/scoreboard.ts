"use server";

import { headers } from "next/headers";

import { verifyMutationSession } from "@/lib/auth/verify-mutation-session";
import {
  runCreateScoreboardAccessMutation,
  runRevokeScoreboardAccessMutation,
} from "@/lib/scoreboard/scoreboard-access";
import {
  executeCreateScoreboardAccess,
  executeRevokeScoreboardAccess,
} from "@/lib/scoreboard/scoreboard-access-data";

export async function createScoreboardAccessAction(input: unknown) {
  const requestHeaders = await headers();
  return runCreateScoreboardAccessMutation(
    input,
    requestHeaders.get("x-correlation-id"),
    {
      executeCreate: executeCreateScoreboardAccess,
      verifySession: verifyMutationSession,
    },
  );
}

export async function revokeScoreboardAccessAction(input: unknown) {
  const requestHeaders = await headers();
  return runRevokeScoreboardAccessMutation(
    input,
    requestHeaders.get("x-correlation-id"),
    {
      executeRevoke: executeRevokeScoreboardAccess,
      verifySession: verifyMutationSession,
    },
  );
}
