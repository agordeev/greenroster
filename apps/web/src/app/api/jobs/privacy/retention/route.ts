import { cronBearerMatches } from "../../../../../lib/jobs/cron-auth";
import {
  executePrivacyRetention,
  type PrivacyRetentionResult,
} from "../../../../../lib/privacy/privacy-retention-data";

type Dependencies = Readonly<{
  getJobSecret: () => string | Promise<string>;
  runOne: () => Promise<PrivacyRetentionResult>;
}>;

const defaults: Dependencies = {
  getJobSecret: async () => {
    const { webRuntimeEnv } = await import("../../../../../lib/runtime-env");
    return webRuntimeEnv.cronSecret;
  },
  runOne: executePrivacyRetention,
};

function response(status: number, body: Readonly<Record<string, unknown>>) {
  return Response.json(body, {
    headers: { "Cache-Control": "no-store" },
    status,
  });
}

export async function handlePrivacyRetentionRequest(
  request: Request,
  overrides?: Partial<Dependencies>,
): Promise<Response> {
  const dependencies = { ...defaults, ...overrides };
  let secret: string;
  try {
    secret = await dependencies.getJobSecret();
  } catch {
    return response(503, { ok: false, status: "unavailable" });
  }

  if (!cronBearerMatches(request.headers.get("authorization"), secret)) {
    return response(401, { ok: false, status: "unauthorized" });
  }

  try {
    await dependencies.runOne();
    return response(200, { ok: true, status: "completed" });
  } catch {
    return response(503, { ok: false, status: "unavailable" });
  }
}

export async function GET(request: Request): Promise<Response> {
  return handlePrivacyRetentionRequest(request);
}

export async function POST(request: Request): Promise<Response> {
  return handlePrivacyRetentionRequest(request);
}
