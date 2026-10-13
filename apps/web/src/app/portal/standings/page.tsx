import Link from "next/link";
import { redirect } from "next/navigation";
import { isAuthRetryableFetchError } from "@supabase/supabase-js";
import { z } from "zod";

import {
  ActionRow,
  EmptyState,
  Kicker,
  portalPanelClass,
  TextLink,
} from "@/components/blocks";
import { Button } from "@/components/ui/button";
import { signInPath } from "@/lib/auth/safe-return-path";
import { verifyMutationSession } from "@/lib/auth/verify-mutation-session";
import {
  executeReadMemberStandings,
  isQuotaRulesMissing,
} from "@/lib/rounds/member-results-data";
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
          className={portalPanelClass}
          aria-labelledby="standings-denied-title"
        >
          <Kicker>Order of Merit</Kicker>
          <h1 id="standings-denied-title">You can&apos;t open this page</h1>
          <p>
            You can see standings from your member home. Only coordinators and
            administrators can open this page.
          </p>
          <TextLink href="/portal">Return to portal home</TextLink>
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
    if (isQuotaRulesMissing(error)) {
      return renderQuotaRulesNeeded(portalContext);
    }
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
        className={portalPanelClass}
        aria-labelledby="portal-standings-title"
      >
        <Kicker>Order of Merit</Kicker>
        <h1 id="portal-standings-title">Standings</h1>
        <p>
          Merit totals, ranks, rounds played, and current quotas for{" "}
          {context?.group_name ?? portalContext.groupName}.
        </p>
        <p>
          <TextLink href="/api/portal/exports?kind=standings">
            Download standings (CSV)
          </TextLink>{" "}
          <TextLink href="/api/portal/exports?kind=standings&format=pdf">
            Download standings (PDF)
          </TextLink>
        </p>

        <section
          className="mt-8 gap-3 grid grid-cols-4 max-[720px]:grid-cols-2 [&_div]:p-[0.9rem] [&_div]:gap-[0.35rem] [&_div]:border [&_div]:grid [&_div]:min-h-22 [&_div]:rounded-lg [&_span]:text-muted-foreground [&_span]:font-mono [&_span]:text-[0.6875rem] [&_span]:tracking-[0.08em] [&_span]:uppercase [&_strong]:font-mono [&_strong]:text-[1.5rem] [&_strong]:font-medium [&_strong]:tabular-nums"
          data-slot="member-stats-summary"
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
        </section>

        <section
          className="mt-10 pt-8 border-t [&>h2]:mx-0 [&>h2]:text-[1.5rem] [&>h2]:font-semibold [&>h2]:mt-1.5! [&>h2]:mb-0!"
          aria-labelledby="portal-standings-table-title"
        >
          <Kicker>Current standings</Kicker>
          <h2 id="portal-standings-table-title">Members</h2>
          {standings.length === 0 ? (
            <EmptyState>No active members to show in standings yet.</EmptyState>
          ) : (
            <div className="mt-5 border relative overflow-x-auto bg-card">
              <table className="w-full min-w-192 border-collapse text-left [&_tbody_th]:font-semibold [&_tbody_th]:text-primary! [&_tbody_th]:text-[1.125rem]! [&_tbody_tr:last-child_td]:border-b-0 [&_tbody_tr:last-child_th]:border-b-0 [&_td]:py-[0.9rem] [&_td]:px-3 [&_td]:border-b [&_td]:border-b-border/50 [&_td]:align-top [&_td]:text-[0.8125rem] [&_th]:py-[0.9rem] [&_th]:px-3 [&_th]:border-b [&_th]:border-b-border/50 [&_th]:align-top [&_th]:text-[0.8125rem] [&_thead_th]:text-muted-foreground [&_thead_th]:font-mono [&_thead_th]:text-[0.6875rem] [&_thead_th]:tracking-[0.08em] [&_thead_th]:uppercase">
                <caption className="sr-only">
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
                          <span className="mt-1 block text-muted-foreground font-mono text-[0.6875rem] tracking-[0.08em] uppercase">
                            You
                          </span>
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
          <p className="text-muted-foreground leading-[1.55]">
            Ranks and totals cover rounds since the reset date.
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

function renderQuotaRulesNeeded(context: PortalContext) {
  const administrator = context.role === "administrator";
  return (
    <PortalShell
      email={context.email}
      groupName={context.groupName}
      role={context.role}
      timeZone={context.timeZone}
      currentSection="standings"
    >
      <section
        className={portalPanelClass}
        aria-labelledby="standings-setup-title"
      >
        <Kicker>Order of Merit</Kicker>
        <h1 id="standings-setup-title">Standings</h1>
        <p>
          {administrator
            ? "Choose your quota rules to start your standings. Members appear here after that."
            : "Your standings start once an administrator chooses your group's quota rules."}
        </p>
        {administrator ? (
          <ActionRow>
            <Button asChild>
              <Link href="/portal/quota">Choose quota rules</Link>
            </Button>
          </ActionRow>
        ) : null}
      </section>
    </PortalShell>
  );
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
        className={portalPanelClass}
        aria-labelledby="standings-error-title"
      >
        <Kicker>Order of Merit</Kicker>
        <h1 id="standings-error-title">
          {forbidden
            ? "You can&apos;t open this page"
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
  if (!value) return "All rounds";
  try {
    return new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(
      new Date(`${value}T00:00:00Z`),
    );
  } catch {
    return value;
  }
}
