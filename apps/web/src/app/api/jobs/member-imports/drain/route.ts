import { cronBearerMatches } from "../../../../../lib/jobs/cron-auth";
import {
  runMemberImportWorker,
  type MemberImportWorkerResult,
} from "../../../../../lib/member-imports/member-import-worker";

type Dependencies = Readonly<{
  getJobSecret: () => string | Promise<string>;
  runOne: () => Promise<MemberImportWorkerResult>;
}>;

const defaults: Dependencies = {
  getJobSecret: async () => {
    const { webRuntimeEnv } = await import("../../../../../lib/runtime-env");
    return webRuntimeEnv.cronSecret;
  },
  runOne: runMemberImportWorker,
};

export async function runMemberImportDrain(
  runOne: () => Promise<MemberImportWorkerResult> = runMemberImportWorker,
  limit = 5,
): Promise<MemberImportWorkerResult> {
  let latest: MemberImportWorkerResult = { kind: "empty" };
  for (let index = 0; index < limit; index += 1) {
    const result = await runOne();
    if (result.kind === "empty") return latest;
    if (result.kind === "unavailable") return result;
    latest = result;
  }
  return latest;
}

export async function handleMemberImportDrain(
  request: Request,
  overrides?: Partial<Dependencies>,
): Promise<Response> {
  const dependencies = { ...defaults, ...overrides };
  let secret: string;
  try {
    secret = await dependencies.getJobSecret();
  } catch {
    return Response.json({ ok: false, status: "unavailable" }, { status: 503 });
  }
  if (!cronBearerMatches(request.headers.get("authorization"), secret)) {
    return Response.json(
      { ok: false, status: "unauthorized" },
      { status: 401 },
    );
  }
  const result = await runMemberImportDrain(dependencies.runOne);
  return Response.json(
    { ok: result.kind !== "unavailable", status: result.kind },
    {
      headers: { "Cache-Control": "no-store" },
      status: result.kind === "unavailable" ? 503 : 200,
    },
  );
}

export async function GET(request: Request): Promise<Response> {
  return handleMemberImportDrain(request);
}

export async function POST(request: Request): Promise<Response> {
  return handleMemberImportDrain(request);
}
