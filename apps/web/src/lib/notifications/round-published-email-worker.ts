import "server-only";

import { z } from "zod";

import {
  renderRoundPublishedEmail,
  type RoundPublishedEmail,
} from "../../emails/round-published";
import {
  defaultClaimedEmailDependencies,
  runClaimedEmailWorker,
  type InvitationEmailWorkerResult,
  type NotificationEmailProvider,
  type NotificationEmailWorkerConfig,
  type NotificationRpcClient,
} from "./invitation-email-worker";

export type RoundPublishedEmailWorkerDependencies = Readonly<{
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
      description: string;
      format: "individual_net" | "individual_gross";
      groupName: string;
      groupTimeZone: string;
      notificationPreferencesUrl: string;
      scheduledAt: string;
    }>,
  ) => RoundPublishedEmail | Promise<RoundPublishedEmail>;
}>;

const claimRowsSchema = z
  .array(
    z
      .object({
        delivery_id: z.uuid(),
        outbox_job_id: z.uuid(),
        round_id: z.uuid(),
        group_id: z.uuid(),
        group_name: z.string().min(1),
        group_time_zone: z.string().min(1),
        round_description: z.string().min(1),
        scheduled_at: z.string().datetime({ offset: true }),
        format: z.enum(["individual_net", "individual_gross"]),
        recipient_address: z.email(),
        attempt_number: z.number().int().positive(),
      })
      .strict(),
  )
  .max(1);

const defaultDependencies: RoundPublishedEmailWorkerDependencies = {
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
  renderEmail: renderRoundPublishedEmail,
};

function buildActionUrl(appUrl: string, path: string): string {
  const url = new URL(path, appUrl);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("notification preferences URL must use HTTP or HTTPS");
  }
  return url.toString();
}

function buildNotificationPreferencesUrl(appUrl: string): string {
  return buildActionUrl(appUrl, "/member/home#notifications");
}

export async function runRoundPublishedEmailWorker(
  overrides?: Partial<RoundPublishedEmailWorkerDependencies>,
): Promise<InvitationEmailWorkerResult> {
  return runClaimedEmailWorker(
    {
      buildEmailInput: (row, config) => ({
        description: row.round_description,
        format: row.format,
        groupName: row.group_name,
        groupTimeZone: row.group_time_zone,
        notificationPreferencesUrl: buildNotificationPreferencesUrl(
          config.appUrl,
        ),
        scheduledAt: row.scheduled_at,
      }),
      claimFunction: "claim_round_published_email",
      idempotencyPrefix: "round-published",
      rowsSchema: claimRowsSchema,
    },
    { ...defaultDependencies, ...overrides },
  );
}
