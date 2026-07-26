"use server";

import { headers } from "next/headers";

import { verifyMutationSession } from "@/lib/auth/verify-mutation-session";
import { runPendingMemberProfileMutation } from "@/lib/memberships/pending-member-profile";
import { runMemberQuotaBootstrapMutation } from "@/lib/memberships/member-quota-bootstrap";
import { runAdministratorRoleTransferMutation } from "@/lib/memberships/administrator-role-transfer";
import { executeCreatePendingMemberProfile } from "@/lib/memberships/pending-member-profile-data";
import { executeMemberQuotaBootstrap } from "@/lib/memberships/member-quota-bootstrap-data";
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

export async function configureMemberQuotaBootstrapAction(input: unknown) {
  const requestHeaders = await headers();

  return runMemberQuotaBootstrapMutation(
    input,
    requestHeaders.get("x-correlation-id"),
    {
      executeBootstrap: executeMemberQuotaBootstrap,
      verifySession: verifyMutationSession,
    },
  );
}

export async function createPendingMemberProfileAction(input: unknown) {
  const requestHeaders = await headers();

  return runPendingMemberProfileMutation(
    input,
    requestHeaders.get("x-correlation-id"),
    {
      executeCreate: executeCreatePendingMemberProfile,
      verifySession: verifyMutationSession,
    },
  );
}
