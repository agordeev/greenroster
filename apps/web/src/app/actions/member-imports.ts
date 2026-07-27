"use server";

import { headers } from "next/headers";

import { verifyMutationSession } from "../../lib/auth/verify-mutation-session";
import { executeRequestMemberImportApply } from "../../lib/member-imports/member-import-data";
import { runMemberImportApplyRequest } from "../../lib/member-imports/member-import-apply";

export async function requestMemberImportApplyAction(input: unknown) {
  const requestHeaders = await headers();
  return runMemberImportApplyRequest(
    input,
    requestHeaders.get("x-correlation-id"),
    {
      execute: executeRequestMemberImportApply,
      verifySession: verifyMutationSession,
    },
  );
}
