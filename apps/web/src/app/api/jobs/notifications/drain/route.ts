import {
  runInvitationEmailWorker,
  type InvitationEmailWorkerResult,
} from "../../../../../lib/notifications/invitation-email-worker";
import { runMembershipRoleChangeEmailWorker } from "../../../../../lib/notifications/membership-role-change-email-worker";
import { cronBearerMatches } from "../../../../../lib/jobs/cron-auth";

export type NotificationDrainRouteDependencies = Readonly<{
  getJobSecret: () => string | Promise<string>;
  runOne: () => Promise<InvitationEmailWorkerResult>;
}>;

const defaultDependencies: NotificationDrainRouteDependencies = {
  getJobSecret: async () => {
    const { webRuntimeEnv } = await import("../../../../../lib/runtime-env");
    return webRuntimeEnv.cronSecret;
  },
  runOne: () => runNotificationEmailDrain(),
};

export type NotificationEmailWorkerRunners = Readonly<{
  runInvitation: () => Promise<InvitationEmailWorkerResult>;
  runRoleChange: () => Promise<InvitationEmailWorkerResult>;
}>;

export async function runNotificationEmailWorkers(
  overrides?: Partial<NotificationEmailWorkerRunners>,
): Promise<InvitationEmailWorkerResult> {
  const runners: NotificationEmailWorkerRunners = {
    runInvitation: runInvitationEmailWorker,
    runRoleChange: runMembershipRoleChangeEmailWorker,
    ...overrides,
  };
  const results = await Promise.all([
    runners.runInvitation(),
    runners.runRoleChange(),
  ]);
  const unavailable = results.find((result) => result.kind === "unavailable");
  if (unavailable) return unavailable;
  return results.find((result) => result.kind !== "empty") ?? { kind: "empty" };
}

async function drainWorker(
  runOne: () => Promise<InvitationEmailWorkerResult>,
  maxDeliveries: number,
): Promise<InvitationEmailWorkerResult> {
  let lastResult: InvitationEmailWorkerResult = { kind: "empty" };
  for (let index = 0; index < maxDeliveries; index += 1) {
    const result = await runOne();
    if (result.kind === "unavailable") return result;
    if (result.kind === "empty") return lastResult;
    lastResult = result;
  }
  return lastResult;
}

export async function runNotificationEmailDrain(
  overrides?: Partial<NotificationEmailWorkerRunners>,
  maxDeliveriesPerCategory = 25,
): Promise<InvitationEmailWorkerResult> {
  const runners: NotificationEmailWorkerRunners = {
    runInvitation: runInvitationEmailWorker,
    runRoleChange: runMembershipRoleChangeEmailWorker,
    ...overrides,
  };
  const results = await Promise.all([
    drainWorker(runners.runInvitation, maxDeliveriesPerCategory),
    drainWorker(runners.runRoleChange, maxDeliveriesPerCategory),
  ]);
  const unavailable = results.find((result) => result.kind === "unavailable");
  if (unavailable) return unavailable;
  return results.find((result) => result.kind !== "empty") ?? { kind: "empty" };
}

function response(status: number, body: Readonly<Record<string, unknown>>) {
  return Response.json(body, {
    headers: { "Cache-Control": "no-store" },
    status,
  });
}

export async function handleNotificationDrainRequest(
  request: Request,
  overrides?: Partial<NotificationDrainRouteDependencies>,
): Promise<Response> {
  const dependencies = { ...defaultDependencies, ...overrides };
  let expectedSecret: string;
  try {
    expectedSecret = await dependencies.getJobSecret();
  } catch {
    return response(503, { ok: false, status: "unavailable" });
  }

  if (
    !cronBearerMatches(request.headers.get("authorization"), expectedSecret)
  ) {
    return response(401, { ok: false, status: "unauthorized" });
  }

  try {
    const result = await dependencies.runOne();
    if (result.kind === "unavailable") {
      return response(503, { ok: false, status: "unavailable" });
    }
    return response(200, { ok: true, status: result.kind });
  } catch {
    return response(503, { ok: false, status: "unavailable" });
  }
}

export async function POST(request: Request): Promise<Response> {
  return handleNotificationDrainRequest(request);
}

export async function GET(request: Request): Promise<Response> {
  return handleNotificationDrainRequest(request);
}
