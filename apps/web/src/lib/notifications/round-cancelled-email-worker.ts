import "server-only";

import { z } from "zod";

import {
  renderRoundCancelledEmail,
  type RoundCancelledEmail,
} from "../../emails/round-cancelled";
import {
  defaultClaimedEmailDependencies,
  runClaimedEmailWorker,
  type InvitationEmailWorkerResult,
  type NotificationEmailProvider,
  type NotificationEmailWorkerConfig,
  type NotificationRpcClient,
} from "./invitation-email-worker";

export type RoundCancelledEmailWorkerDependencies = Readonly<{
  createClaimToken: () => string;
  createClient: () => NotificationRpcClient | Promise<NotificationRpcClient>;
  createProvider: (apiKey: string) => NotificationEmailProvider;
  getConfig: () =>
    | Pick<
        NotificationEmailWorkerConfig,
        "resendApiKey" | "resendFromEmail" | "maxAttempts" | "retrySeconds"
      >
    | Promise<
        Pick<
          NotificationEmailWorkerConfig,
          "resendApiKey" | "resendFromEmail" | "maxAttempts" | "retrySeconds"
        >
      >;
  now: () => Date;
  renderEmail: (
    input: Readonly<{
      cancellationReason: string;
      description: string;
      groupName: string;
      groupTimeZone: string;
      scheduledAt: string;
    }>,
  ) => RoundCancelledEmail | Promise<RoundCancelledEmail>;
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
        cancellation_reason: z.string().min(1),
        recipient_address: z.email(),
        attempt_number: z.number().int().positive(),
      })
      .strict(),
  )
  .max(1);

const defaultDependencies: RoundCancelledEmailWorkerDependencies = {
  ...defaultClaimedEmailDependencies,
  getConfig: async () => {
    const { webRuntimeEnv } = await import("../runtime-env");
    return {
      resendApiKey: webRuntimeEnv.resendApiKey,
      resendFromEmail: webRuntimeEnv.resendFromEmail,
      maxAttempts: webRuntimeEnv.notificationEmailMaxAttempts,
      retrySeconds: webRuntimeEnv.notificationEmailRetrySeconds,
    };
  },
  renderEmail: renderRoundCancelledEmail,
};

export async function runRoundCancelledEmailWorker(
  overrides?: Partial<RoundCancelledEmailWorkerDependencies>,
): Promise<InvitationEmailWorkerResult> {
  return runClaimedEmailWorker(
    {
      buildEmailInput: (row) => ({
        cancellationReason: row.cancellation_reason,
        description: row.round_description,
        groupName: row.group_name,
        groupTimeZone: row.group_time_zone,
        scheduledAt: row.scheduled_at,
      }),
      claimFunction: "claim_round_cancelled_email",
      idempotencyPrefix: "round-cancelled",
      rowsSchema: claimRowsSchema,
    },
    { ...defaultDependencies, ...overrides },
  );
}
