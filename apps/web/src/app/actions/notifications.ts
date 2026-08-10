"use server";

import { headers } from "next/headers";

import { runMarkMemberInboxReadMutation } from "@/domain/member-inbox";
import { verifyMutationSession } from "@/lib/auth/verify-mutation-session";
import { executeMarkMemberInboxRead } from "@/lib/notifications/member-inbox-data";

export async function markMemberInboxReadAction(input: unknown) {
  const requestHeaders = await headers();
  return runMarkMemberInboxReadMutation(
    input,
    requestHeaders.get("x-correlation-id"),
    {
      execute: executeMarkMemberInboxRead,
      verifySession: verifyMutationSession,
    },
  );
}
