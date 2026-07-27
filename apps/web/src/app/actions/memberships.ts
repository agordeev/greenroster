"use server";

import { headers } from "next/headers";

import { verifyMutationSession } from "@/lib/auth/verify-mutation-session";
import { runPendingMemberProfileMutation } from "@/lib/memberships/pending-member-profile";
import { runMemberQuotaBootstrapMutation } from "@/lib/memberships/member-quota-bootstrap";
import { runAdministratorRoleTransferMutation } from "@/lib/memberships/administrator-role-transfer";
import { executeCreatePendingMemberProfile } from "@/lib/memberships/pending-member-profile-data";
import { executeMemberQuotaBootstrap } from "@/lib/memberships/member-quota-bootstrap-data";
import { executeAdministratorRoleTransfer } from "@/lib/memberships/administrator-role-transfer-data";
import { runIssueInvitationMutation } from "@/lib/invitations/issue-invitation";
import { executeIssueInvitation } from "@/lib/invitations/issue-invitation-data";
import {
  executeCorrectInvitationAddress,
  executeRegenerateInvitation,
  executeRevokeInvitation,
} from "@/lib/invitations/invitation-lifecycle-data";
import {
  runCorrectInvitationMutation,
  runRegenerateInvitationMutation,
  runRevokeInvitationMutation,
} from "@/lib/invitations/invitation-lifecycle";
import {
  runMemberEditMutation,
  runMemberRoleMutation,
  runMemberStatusMutation,
} from "@/lib/memberships/member-management";
import {
  executeChangeMemberRole,
  executeEditMember,
  executeSetMemberStatus,
} from "@/lib/memberships/member-management-data";

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

export async function issueMembershipInvitationAction(input: unknown) {
  const requestHeaders = await headers();

  return runIssueInvitationMutation(
    input,
    requestHeaders.get("x-correlation-id"),
    {
      executeIssue: executeIssueInvitation,
      verifySession: verifyMutationSession,
    },
  );
}

export async function regenerateMembershipInvitationAction(input: unknown) {
  const requestHeaders = await headers();

  return runRegenerateInvitationMutation(
    input,
    requestHeaders.get("x-correlation-id"),
    {
      executeRegenerate: executeRegenerateInvitation,
      verifySession: verifyMutationSession,
    },
  );
}

export async function correctMembershipInvitationAction(input: unknown) {
  const requestHeaders = await headers();

  return runCorrectInvitationMutation(
    input,
    requestHeaders.get("x-correlation-id"),
    {
      executeCorrect: executeCorrectInvitationAddress,
      verifySession: verifyMutationSession,
    },
  );
}

export async function revokeMembershipInvitationAction(input: unknown) {
  const requestHeaders = await headers();

  return runRevokeInvitationMutation(
    input,
    requestHeaders.get("x-correlation-id"),
    {
      executeRevoke: executeRevokeInvitation,
      verifySession: verifyMutationSession,
    },
  );
}

export async function editMemberAction(input: unknown) {
  const requestHeaders = await headers();

  return runMemberEditMutation(input, requestHeaders.get("x-correlation-id"), {
    execute: executeEditMember,
    verifySession: verifyMutationSession,
  });
}

export async function setMemberStatusAction(input: unknown) {
  const requestHeaders = await headers();

  return runMemberStatusMutation(
    input,
    requestHeaders.get("x-correlation-id"),
    {
      execute: executeSetMemberStatus,
      verifySession: verifyMutationSession,
    },
  );
}

export async function changeMemberRoleAction(input: unknown) {
  const requestHeaders = await headers();

  return runMemberRoleMutation(input, requestHeaders.get("x-correlation-id"), {
    execute: executeChangeMemberRole,
    verifySession: verifyMutationSession,
  });
}
