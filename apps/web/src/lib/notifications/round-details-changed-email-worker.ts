import "server-only";

import { z } from "zod";

import {
  renderRoundDetailsChangedEmail,
  type RoundDetailsChangedEmail,
} from "../../emails/round-details-changed";
import {
  defaultClaimedEmailDependencies,
  runClaimedEmailWorker,
  type InvitationEmailWorkerResult,
  type NotificationEmailProvider,
  type NotificationEmailWorkerConfig,
  type NotificationRpcClient,
} from "./invitation-email-worker";

export type RoundDetailsChangedEmailWorkerDependencies = Readonly<{
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
      groupName: string;
      groupTimeZone: string;
      notificationPreferencesUrl: string;
      scheduledAt: string;
      venue: string | null;
      rsvpDeadlineAt: string | null;
    }>,
  ) => RoundDetailsChangedEmail | Promise<RoundDetailsChangedEmail>;
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
        venue: z.string().nullable(),
        rsvp_deadline_at: z.string().datetime({ offset: true }).nullable(),
        recipient_address: z.email(),
        attempt_number: z.number().int().positive(),
      })
      .strict(),
  )
  .max(1);

const defaultDependencies: RoundDetailsChangedEmailWorkerDependencies = {
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
  renderEmail: renderRoundDetailsChangedEmail,
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

export async function runRoundDetailsChangedEmailWorker(
  overrides?: Partial<RoundDetailsChangedEmailWorkerDependencies>,
): Promise<InvitationEmailWorkerResult> {
  return runClaimedEmailWorker(
    {
      buildEmailInput: (row, config) => ({
        description: row.round_description,
        groupName: row.group_name,
        groupTimeZone: row.group_time_zone,
        notificationPreferencesUrl: buildNotificationPreferencesUrl(
          config.appUrl,
        ),
        scheduledAt: row.scheduled_at,
        venue: row.venue,
        rsvpDeadlineAt: row.rsvp_deadline_at,
      }),
      claimFunction: "claim_round_details_changed_email",
      idempotencyPrefix: "round-details-changed",
      rowsSchema: claimRowsSchema,
    },
    { ...defaultDependencies, ...overrides },
  );
}
