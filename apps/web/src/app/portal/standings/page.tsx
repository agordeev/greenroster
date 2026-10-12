import Link from "next/link";
import { redirect } from "next/navigation";
import { isAuthRetryableFetchError } from "@supabase/supabase-js";
import { z } from "zod";

import { signInPath } from "@/lib/auth/safe-return-path";
import { verifyMutationSession } from "@/lib/auth/verify-mutation-session";
import { executeReadMemberStandings } from "@/lib/rounds/member-results-data";
import { MutationError } from "@/lib/mutations/result";
import { createServerComponentSupabaseClient } from "@/lib/supabase/server-component-client";

import { PortalShell } from "../portal-shell";

const contextSchema = z
  .array(
    z
      .object({
        membership_id: z.uuid(),
        group_id: z.uuid(),
        role: z.enum(["member", "coordinator", "administrator"]),
      })
      .strict(),
  )
  .max(1);

const groupSchema = z
  .object({ name: z.string(), time_zone: z.string() })
  .strict();

type PortalContext = Readonly<{
  email: string;
  groupName: string;
  role: "member" | "coordinator" | "administrator";
  timeZone: string;
}>;

export default async function PortalStandingsPage() {
  let session: Awaited<ReturnType<typeof verifyMutationSession>>;
  try {
    session = await verifyMutationSession();
  } catch (error) {
    return renderStandingsError(error);
  }

  let portalContext: PortalContext;
  try {
    portalContext = await resolvePortalContext();
  } catch (error) {
    return renderStandingsError(error);
  }

  if (portalContext.role === "member") {
    return (
      <PortalShell
        email={portalContext.email}
        groupName={portalContext.groupName}
        role={portalContext.role}
        timeZone={portalContext.timeZone}
        currentSection="standings"
      >
        <section
          className="portal-ledger role-denied"
          aria-labelledby="standings-denied-title"
        >
          <p className="ledger-kicker">Order of Merit</p>
          <h1 id="standings-denied-title">
            Portal standings are not available
          </h1>
          <p>
            You can see standings from your member home. Only coordinators and
            administrators can open this page.
          </p>
          <Link className="secondary-link" href="/portal">
            Return to portal home
          </Link>
        </section>
      </PortalShell>
    );
  }

  let standings;
  try {
    // The portal role was resolved from the authenticated membership above.
    // Only coordinator and administrator contexts reach this service read.
    standings = await executeReadMemberStandings(session.userId);
  } catch (error) {
    return renderStandingsError(error, portalContext);
  }

  const context = standings[0] ?? null;
  const projectionReadyCount = standings.filter(
    (row) => row.quota_projection_ready,
  ).length;

  return (
    <PortalShell
      email={portalContext.email}
      groupName={portalContext.groupName}
      role={portalContext.role}
      timeZone={portalContext.timeZone}
      currentSection="standings"
    >
      <section
        className="portal-ledger member-results-page"
        aria-labelledby="portal-standings-title"
      >
        <p className="ledger-kicker">Order of Merit</p>
        <h1 id="portal-standings-title">Standings</h1>
        <p>
          Merit totals, ranks, rounds played, and quota projections for{" "}
          {context?.group_name ?? portalContext.groupName}. The reset date
          changes only the current standings. Quota history is kept separately.
        </p>
        <p>
          <Link
            className="secondary-link"
            href="/api/portal/exports?kind=standings"
          >
            Download standings (CSV)
          </Link>{" "}
          <Link
            className="secondary-link"
            href="/api/portal/exports?kind=standings&format=pdf"
          >
            Download standings (PDF)
          </Link>
        </p>

        <section
          className="member-stats-summary"
          aria-label="Standings summary"
        >
          <div>
            <span>Active members</span>
            <strong>{standings.length}</strong>
          </div>
          <div>
            <span>Quota ready</span>
            <strong>{projectionReadyCount}</strong>
          </div>
          <div>
            <span>Reset date</span>
            <strong>
              {formatResetDate(context?.standings_reset_date ?? null)}
            </strong>
          </div>
          <div>
            <span>Time zone</span>
            <strong>
              {context?.group_time_zone ?? portalContext.timeZone}
            </strong>
          </div>
        </section>

        <section
          className="member-read-section"
          aria-labelledby="portal-standings-table-title"
        >
          <p className="ledger-kicker">Current standings</p>
          <h2 id="portal-standings-table-title">Members</h2>
          {standings.length === 0 ? (
            <p className="group-empty" role="status">
              No active members to show in standings yet.
            </p>
          ) : (
            <div className="member-results-table-wrap">
              <table className="member-results-table">
                <caption className="visually-hidden">
                  Current Order of Merit standings
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Rank</th>
                    <th scope="col">Member</th>
                    <th scope="col">Merit</th>
                    <th scope="col">Rounds</th>
                    <th scope="col">Current quota</th>
                    <th scope="col">Quota status</th>
                  </tr>
                </thead>
                <tbody>
                  {standings.map((row) => (
                    <tr key={row.membership_id}>
                      <th scope="row">{row.standing_rank ?? "—"}</th>
                      <td>
                        <strong>
                          {displayName(row.first_name, row.last_name)}
                        </strong>
                        {row.is_actor ? (
                          <span className="member-results-guest">You</span>
                        ) : null}
                      </td>
                      <td>{row.merit_total ?? "0"}</td>
                      <td>{row.rounds_played}</td>
                      <td>{row.projected_quota ?? "Not available"}</td>
                      <td>
                        {row.quota_projection_ready
                          ? "Ready"
                          : row.uses_initial_quota_next
                            ? "Starting quota next"
                            : "Needs more history"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="member-read-note">
            Ranks and totals cover the current standings period. Guests and
            starting quota figures never count as members or rounds played.
          </p>
        </section>
      </section>
    </PortalShell>
  );
}

async function resolvePortalContext(): Promise<PortalContext> {
  const supabase = await createServerComponentSupabaseClient();
  let userResult: Awaited<ReturnType<typeof supabase.auth.getUser>>;
  try {
    userResult = await supabase.auth.getUser();
  } catch (error) {
    throw new MutationError("transient", { cause: error });
  }
  if (userResult.error && isAuthRetryableFetchError(userResult.error)) {
    throw new MutationError("transient", { cause: userResult.error });
  }
  if (userResult.error || !userResult.data.user?.email) {
    throw new MutationError("authentication_required", {
      cause: userResult.error,
    });
  }

  const contextResult = await supabase.rpc("resolve_identity_context");
  const parsedContext = contextSchema.safeParse(contextResult.data);
  const context = parsedContext.success ? parsedContext.data[0] : undefined;
  if (contextResult.error || !parsedContext.success || !context) {
    throw new MutationError("forbidden", { cause: contextResult.error });
  }

  const groupResult = await supabase
    .from("groups")
    .select("name,time_zone")
    .eq("id", context.group_id)
    .single();
  const parsedGroup = groupSchema.safeParse(groupResult.data);
  if (groupResult.error || !parsedGroup.success) {
    throw new MutationError("transient", { cause: groupResult.error });
  }

  return {
    email: userResult.data.user.email,
    groupName: parsedGroup.data.name,
    role: context.role,
    timeZone: parsedGroup.data.time_zone,
  };
}

function renderStandingsError(error: unknown, context?: PortalContext) {
  if (
    error instanceof MutationError &&
    error.code === "authentication_required"
  ) {
    redirect(signInPath("/portal/standings"));
  }

  const forbidden =
    error instanceof MutationError && error.code === "forbidden";
  return (
    <PortalShell
      email={context?.email ?? "Signed-in account"}
      groupName={context?.groupName ?? "Current group"}
      {...(context
        ? { role: context.role, timeZone: context.timeZone }
        : { roleStatus: "Access unavailable", timeZone: "" })}
      currentSection="standings"
    >
      <section
        className="portal-ledger"
        aria-labelledby="standings-error-title"
      >
        <p className="ledger-kicker">Order of Merit</p>
        <h1 id="standings-error-title">
          {forbidden
            ? "Portal standings are not available"
            : "Standings could not be loaded"}
        </h1>
        <p>
          {forbidden
            ? "Only coordinators and administrators can open this page."
            : "We couldn't load standings right now. Refresh and try again."}
        </p>
      </section>
    </PortalShell>
  );
}

function displayName(firstName: string | null, lastName: string | null) {
  return (
    [firstName, lastName]
      .filter((value): value is string => Boolean(value?.trim()))
      .join(" ")
      .trim() || "Unnamed member"
  );
}

function formatResetDate(value: string | null) {
  if (!value) return "All eligible history";
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(
      new Date(`${value}T00:00:00Z`),
    );
  } catch {
    return value;
  }
}
