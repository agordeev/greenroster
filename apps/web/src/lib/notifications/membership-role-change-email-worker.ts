import "server-only";

import { z } from "zod";

import {
  renderMembershipRoleChangeEmail,
  type MembershipRole,
  type MembershipRoleChangeEmail,
} from "../../emails/membership-role-change";
import {
  defaultClaimedEmailDependencies,
  runClaimedEmailWorker,
  type InvitationEmailWorkerResult,
  type NotificationEmailProvider,
  type NotificationEmailWorkerConfig,
  type NotificationRpcClient,
} from "./invitation-email-worker";

export type MembershipRoleChangeEmailWorkerDependencies = Readonly<{
  createClaimToken: () => string;
  createClient: () => NotificationRpcClient | Promise<NotificationRpcClient>;
  createProvider: (apiKey: string) => NotificationEmailProvider;
  getConfig: () =>
    | Pick<
        NotificationEmailWorkerConfig,
        | "appUrl"
        | "resendApiKey"
        | "resendFromEmail"
        | "maxAttempts"
        | "retrySeconds"
      >
    | Promise<
        Pick<
          NotificationEmailWorkerConfig,
          | "appUrl"
          | "resendApiKey"
          | "resendFromEmail"
          | "maxAttempts"
          | "retrySeconds"
        >
      >;
  now: () => Date;
  renderEmail: (
    input: Readonly<{
      actionUrl: string;
      groupName: string;
      oldRole: MembershipRole;
      newRole: MembershipRole;
    }>,
  ) => MembershipRoleChangeEmail | Promise<MembershipRoleChangeEmail>;
}>;

const roleClaimRowsSchema = z
  .array(
    z
      .object({
        delivery_id: z.uuid(),
        outbox_job_id: z.uuid(),
        membership_id: z.uuid(),
        group_id: z.uuid(),
        group_name: z.string().min(1),
        recipient_address: z.email(),
        old_role: z.enum(["member", "coordinator", "administrator"]),
        new_role: z.enum(["member", "coordinator", "administrator"]),
        attempt_number: z.number().int().positive(),
      })
      .strict(),
  )
  .max(1);

const defaultDependencies: MembershipRoleChangeEmailWorkerDependencies = {
  ...defaultClaimedEmailDependencies,
  getConfig: async () => {
    const { webRuntimeEnv } = await import("../runtime-env");
    return {
      appUrl: webRuntimeEnv.appUrl,
      resendApiKey: webRuntimeEnv.resendApiKey,
      resendFromEmail: webRuntimeEnv.resendFromEmail,
      maxAttempts: webRuntimeEnv.notificationEmailMaxAttempts,
      retrySeconds: webRuntimeEnv.notificationEmailRetrySeconds,
    };
  },
  renderEmail: renderMembershipRoleChangeEmail,
};

function buildRoleActionUrl(
  appUrl: string,
  membershipId: string,
  newRole: MembershipRole,
): string {
  const path =
    newRole === "member"
      ? "/member/home"
      : `/portal/members?membership=${encodeURIComponent(membershipId)}`;
  const url = new URL(path, appUrl);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("role action URL must use HTTP or HTTPS");
  }
  return url.toString();
}

export async function runMembershipRoleChangeEmailWorker(
  overrides?: Partial<MembershipRoleChangeEmailWorkerDependencies>,
): Promise<InvitationEmailWorkerResult> {
  return runClaimedEmailWorker(
    {
      buildEmailInput: (row, config) => ({
        actionUrl: buildRoleActionUrl(
          config.appUrl,
          row.membership_id,
          row.new_role,
        ),
        groupName: row.group_name,
        oldRole: row.old_role,
        newRole: row.new_role,
      }),
      claimFunction: "claim_membership_role_change_email",
      idempotencyPrefix: "membership-role-change",
      rowsSchema: roleClaimRowsSchema,
    },
    { ...defaultDependencies, ...overrides },
  );
}

export const runRoleChangeEmailWorker = runMembershipRoleChangeEmailWorker;
