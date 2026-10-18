"use server";

import { headers } from "next/headers";

import { runMarkMemberInboxReadMutation } from "@/domain/member-inbox";
import { runSetEmailPreferenceMutation } from "@/domain/notification-preference";
import { verifyMutationSession } from "@/lib/auth/verify-mutation-session";
import { executeMarkMemberInboxRead } from "@/lib/notifications/member-inbox-data";
import { executeSetEmailPreference } from "@/lib/notifications/notification-preference-data";

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

export async function setEmailPreferenceAction(input: unknown) {
  const requestHeaders = await headers();
  return runSetEmailPreferenceMutation(
    input,
    requestHeaders.get("x-correlation-id"),
    {
      execute: executeSetEmailPreference,
      verifySession: verifyMutationSession,
    },
  );
}
