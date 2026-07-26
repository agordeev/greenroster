"use server";

import { headers } from "next/headers";

import { verifyMutationSession } from "@/lib/auth/verify-mutation-session";
import { runAdministratorRoleTransferMutation } from "@/lib/memberships/administrator-role-transfer";
import { executeAdministratorRoleTransfer } from "@/lib/memberships/administrator-role-transfer-data";

export async function transferAdministratorRoleAction(input: unknown) {
  const requestHeaders = await headers();

  return runAdministratorRoleTransferMutation(
    input,
    requestHeaders.get("x-correlation-id"),
    {
      verifySession: verifyMutationSession,
      executeTransfer: executeAdministratorRoleTransfer,
    },
  );
}
