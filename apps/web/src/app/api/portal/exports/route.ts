import { z } from "zod";

import { parseMemberRosterQuery } from "@/domain/member-roster-query";
import { verifyMutationSession } from "@/lib/auth/verify-mutation-session";
import { executeListManageableMemberRoster } from "@/lib/memberships/member-management-data";
import {
  executeReadMemberOfficialResults,
  executeReadMemberStandings,
} from "@/lib/rounds/member-results-data";
import { createServerComponentSupabaseClient } from "@/lib/supabase/server-component-client";
import { createSupabaseServiceClient } from "@/lib/supabase/service-client";
import {
  createMemberRosterCsv,
  createOfficialResultsCsv,
  createStandingsCsv,
} from "@/lib/exports/csv-export";
import {
  createMemberRosterPdf,
  createOfficialResultsPdf,
  createScorepadPdf,
  createStandingsPdf,
} from "@/lib/exports/pdf-report";

export const dynamic = "force-dynamic";

const kindSchema = z.enum(["members", "standings", "results", "scorepad"]);
const roundIdSchema = z.uuid();
const formatSchema = z.enum(["csv", "pdf"]).default("csv");

type ExportContext = Readonly<{
  groupId: string;
  role: "coordinator" | "administrator";
  groupName?: string;
  timeZone?: string;
}>;

type ExportDependencies = Readonly<{
  verifySession: typeof verifyMutationSession;
  resolveContext: () => Promise<ExportContext | null>;
  loadRoster: typeof executeListManageableMemberRoster;
  loadStandings: typeof executeReadMemberStandings;
  loadResults: typeof executeReadMemberOfficialResults;
  recordAudit: (input: {
    actorUserId: string;
    groupId: string;
    kind: "members" | "standings" | "results" | "scorepad";
    format: "csv" | "pdf";
    rowCount: number;
    correlationId: string;
    filter: string;
  }) => Promise<void>;
}>;

const defaultDependencies: ExportDependencies = {
  verifySession: verifyMutationSession,
  resolveContext: resolvePortalExportContext,
  loadRoster: executeListManageableMemberRoster,
  loadStandings: executeReadMemberStandings,
  loadResults: executeReadMemberOfficialResults,
  recordAudit: recordExportAudit,
};

export async function handlePortalExport(
  request: Request,
  overrides: Partial<ExportDependencies> = {},
): Promise<Response> {
  const dependencies = { ...defaultDependencies, ...overrides };
  const url = new URL(request.url);
  const kind = kindSchema.safeParse(url.searchParams.get("kind"));
  if (!kind.success) {
    return jsonError("Choose an export type.", 400);
  }
  const format = formatSchema.safeParse(
    url.searchParams.get("format") ?? undefined,
  );
  if (!format.success) return jsonError("Choose a report format.", 400);
  if (kind.data === "scorepad" && format.data !== "pdf") {
    return jsonError("The score pad is available as a PDF report.", 400);
  }

  let session: Awaited<ReturnType<typeof verifyMutationSession>>;
  try {
    session = await dependencies.verifySession();
  } catch {
    return jsonError("Sign in to download this export.", 401);
  }

  let context: ExportContext | null;
  try {
    context = await dependencies.resolveContext();
  } catch {
    return jsonError("Your group is unavailable right now.", 503);
  }
  if (!context) return jsonError("Your access does not include exports.", 403);

  const correlationId =
    request.headers.get("x-correlation-id") ?? crypto.randomUUID();
  let output: string | Uint8Array;
  let filename: string;
  let rowCount = 0;
  const metadata = {
    groupName: context.groupName ?? "GreenRoster group",
    generatedAt: new Date().toISOString(),
    timeZone: context.timeZone ?? "UTC",
    reportingWindow: "Current group data",
    containsPrivateData: kind.data === "members",
  } as const;

  try {
    if (kind.data === "members") {
      const query = parseMemberRosterQuery(
        Object.fromEntries(url.searchParams.entries()),
      );
      const rows = [] as Awaited<
        ReturnType<typeof dependencies.loadRoster>
      >["members"] extends readonly (infer T)[]
        ? T[]
        : never[];
      let page = 1;
      let totalCount = 0;
      do {
        const pageResult = await dependencies.loadRoster(session.userId, {
          ...query,
          page,
          pageSize: 100,
        });
        rows.push(...pageResult.members);
        totalCount = pageResult.totalCount;
        page += 1;
        if (rows.length > 5000 && totalCount > rows.length) {
          return jsonError(
            "Your export is too large. Narrow your filters and try again.",
            413,
          );
        }
      } while (rows.length < totalCount && rows.length > 0);
      output =
        format.data === "pdf"
          ? createMemberRosterPdf(metadata, rows)
          : createMemberRosterCsv(rows);
      rowCount = rows.length;
      filename = `greenroster-members.${format.data}`;
    } else if (kind.data === "standings") {
      const rows = await dependencies.loadStandings(session.userId);
      output =
        format.data === "pdf"
          ? createStandingsPdf(metadata, rows)
          : createStandingsCsv(rows);
      rowCount = rows.length;
      filename = `greenroster-standings.${format.data}`;
    } else {
      const roundId = roundIdSchema.safeParse(url.searchParams.get("round_id"));
      if (!roundId.success) return jsonError("Choose a completed round.", 400);
      const result = await dependencies.loadResults(
        session.userId,
        roundId.data,
      );
      output =
        format.data === "pdf"
          ? kind.data === "scorepad"
            ? createScorepadPdf(metadata, result.round, result.results)
            : createOfficialResultsPdf(metadata, result.round, result.results)
          : createOfficialResultsCsv(result.round, result.results);
      rowCount = result.results.length;
      filename = `greenroster-${kind.data}.${format.data}`;
    }
    await dependencies.recordAudit({
      actorUserId: session.userId,
      groupId: context.groupId,
      kind: kind.data,
      format: format.data,
      rowCount,
      correlationId,
      filter: url.searchParams.toString(),
    });
  } catch {
    return jsonError("Your export is unavailable right now.", 503);
  }

  const body: BodyInit =
    typeof output === "string"
      ? output
      : new Blob([output as unknown as ArrayBuffer]);
  return new Response(body, {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Type":
        format.data === "pdf" ? "application/pdf" : "text/csv; charset=utf-8",
      "X-GreenRoster-Export-Rows": String(rowCount),
    },
  });
}

export async function GET(request: Request): Promise<Response> {
  return handlePortalExport(request);
}

async function resolvePortalExportContext(): Promise<ExportContext | null> {
  const supabase = await createServerComponentSupabaseClient();
  const result = await supabase.rpc("resolve_identity_context");
  const parsed = z
    .array(
      z.object({
        group_id: z.uuid(),
        role: z.enum(["member", "coordinator", "administrator"]),
      }),
    )
    .length(1)
    .safeParse(result.data);
  if (result.error || !parsed.success) return null;
  const context = parsed.data[0];
  if (context.role === "member") return null;
  const group = await supabase
    .from("groups")
    .select("name,time_zone")
    .eq("id", context.group_id)
    .maybeSingle();
  if (group.error || !group.data) return null;
  return {
    groupId: context.group_id,
    role: context.role,
    groupName: group.data.name,
    timeZone: group.data.time_zone,
  };
}

async function recordExportAudit(input: {
  actorUserId: string;
  groupId: string;
  kind: "members" | "standings" | "results" | "scorepad";
  format: "csv" | "pdf";
  rowCount: number;
  correlationId: string;
  filter: string;
}): Promise<void> {
  const service = createSupabaseServiceClient();
  const { error } = await service.from("audit_events").insert({
    group_id: input.groupId,
    actor_user_id: input.actorUserId,
    action: "report.exported",
    target_type: "report",
    after_state: {
      kind: input.kind,
      format: input.format,
      row_count: input.rowCount,
      filter: input.filter,
    },
    source: "web",
    correlation_id: input.correlationId,
  });
  if (error) throw error;
}

function jsonError(message: string, status: number): Response {
  return Response.json(
    {
      code: status === 401 ? "authentication_required" : "export_unavailable",
      message,
    },
    { status, headers: { "Cache-Control": "private, no-store" } },
  );
}
