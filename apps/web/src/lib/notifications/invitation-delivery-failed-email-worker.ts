import "server-only";

import { z } from "zod";

import {
  renderInvitationDeliveryFailedEmail,
  type InvitationDeliveryFailedEmail,
} from "../../emails/invitation-delivery-failed";
import {
  defaultClaimedEmailDependencies,
  runClaimedEmailWorker,
  type InvitationEmailWorkerResult,
  type NotificationEmailProvider,
  type NotificationEmailWorkerConfig,
  type NotificationRpcClient,
} from "./invitation-email-worker";

export type InvitationDeliveryFailedEmailWorkerDependencies = Readonly<{
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
      invitedAddress: string;
    }>,
  ) => InvitationDeliveryFailedEmail | Promise<InvitationDeliveryFailedEmail>;
}>;

const claimRowsSchema = z
  .array(
    z
      .object({
        delivery_id: z.uuid(),
        outbox_job_id: z.uuid(),
        invitation_id: z.uuid(),
        group_id: z.uuid(),
        group_name: z.string().min(1),
        recipient_address: z.email(),
        invited_address: z.email(),
        attempt_number: z.number().int().positive(),
      })
      .strict(),
  )
  .max(1);

const defaultDependencies: InvitationDeliveryFailedEmailWorkerDependencies = {
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
  renderEmail: renderInvitationDeliveryFailedEmail,
};

function buildActionUrl(appUrl: string, invitationId: string): string {
  const url = new URL("/portal/invitations", appUrl);
  url.searchParams.set("delivery", "action-required");
  url.searchParams.set("invitation", invitationId);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("invitation delivery action URL must use HTTP or HTTPS");
  }
  return url.toString();
}

export async function runInvitationDeliveryFailedEmailWorker(
  overrides?: Partial<InvitationDeliveryFailedEmailWorkerDependencies>,
): Promise<InvitationEmailWorkerResult> {
  return runClaimedEmailWorker(
    {
      buildEmailInput: (row, config) => ({
        actionUrl: buildActionUrl(config.appUrl, row.invitation_id),
        groupName: row.group_name,
        invitedAddress: row.invited_address,
      }),
      claimFunction: "claim_invitation_delivery_failed_email",
      idempotencyPrefix: "invitation-delivery-failed",
      rowsSchema: claimRowsSchema,
    },
    { ...defaultDependencies, ...overrides },
  );
}
