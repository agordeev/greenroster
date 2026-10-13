import { redirect } from "next/navigation";

import {
  executeReadMemberQuotaHistory,
  executeReadMemberStandings,
} from "@/lib/rounds/member-results-data";
import { resolveMemberPageSession } from "@/lib/auth/member-page-session";
import { signInPath } from "@/lib/auth/safe-return-path";
import {
  Kicker,
  SkipLink,
  standalonePageWideClass,
  standalonePanelClass,
  standalonePanelFullClass,
  TextLink,
} from "@/components/blocks";
import { MemberNav } from "../member-nav";

export default async function MemberStandingsPage() {
  const access = await resolveMemberPageSession();
  if (access.state === "authentication_required") {
    redirect(signInPath("/member/standings"));
  }
  if (access.state === "recovery_active") redirect("/reset-password");
  if (access.state === "role_redirect") redirect("/portal");
  if (access.state !== "ready") return <MemberStandingsUnavailable />;

  let data: Awaited<ReturnType<typeof executeReadMemberStandings>>;
  let history: Awaited<ReturnType<typeof executeReadMemberQuotaHistory>>;
  try {
    [data, history] = await Promise.all([
      executeReadMemberStandings(access.userId),
      executeReadMemberQuotaHistory(access.userId),
    ]);
  } catch {
    return <MemberStandingsUnavailable />;
  }
  return <MemberStandingsContent standings={data} history={history} />;
}

function MemberStandingsContent({
  standings,
  history,
}: Readonly<{
  standings: Awaited<ReturnType<typeof executeReadMemberStandings>>;
  history: Awaited<ReturnType<typeof executeReadMemberQuotaHistory>>;
}>) {
  const context = standings[0];
  const own = standings.find((row) => row.is_actor) ?? standings[0];
  const formatDate = (value: string | null) =>
    value
      ? new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(
          new Date(`${value}T00:00:00Z`),
        )
      : "all eligible rounds";

  return (
    <>
      <SkipLink />
      <main id="main-content" tabIndex={-1} className={standalonePageWideClass}>
        <section
          className={standalonePanelFullClass}
          data-slot="auth-ledger"
          aria-labelledby="member-standings-title"
        >
          <MemberNav current="standings" />
          <Kicker>{context?.group_name ?? "Your group"}</Kicker>
          <h1 id="member-standings-title">Standings</h1>
          <p className="text-muted-foreground leading-[1.55]">
            Order of Merit · counting from:{" "}
            {formatDate(context?.standings_reset_date ?? null)}
          </p>
          <section
            className="mt-8 gap-3 grid grid-cols-4 max-[720px]:grid-cols-2 [&_div]:p-[0.9rem] [&_div]:gap-[0.35rem] [&_div]:border [&_div]:grid [&_div]:min-h-22 [&_div]:rounded-lg [&_span]:text-muted-foreground [&_span]:font-mono [&_span]:text-[0.6875rem] [&_span]:tracking-[0.08em] [&_span]:uppercase [&_strong]:font-mono [&_strong]:text-[1.5rem] [&_strong]:font-medium [&_strong]:tabular-nums"
            data-slot="member-stats-summary"
            aria-label="Your standings summary"
          >
            <div>
              <span>Current quota</span>
              <strong>{own?.projected_quota ?? "Not available"}</strong>
            </div>
            <div>
              <span>Merit total</span>
              <strong>{own?.merit_total ?? "0"}</strong>
            </div>
            <div>
              <span>Rounds played</span>
              <strong>{own?.rounds_played ?? "0"}</strong>
            </div>
            <div>
              <span>Order of Merit rank</span>
              <strong>{own?.standing_rank ?? "Not ranked"}</strong>
            </div>
          </section>
          <section
            className="mt-10 pt-8 border-t [&>h2]:mx-0 [&>h2]:text-[1.5rem] [&>h2]:font-semibold [&>h2]:mt-1.5! [&>h2]:mb-0!"
            aria-labelledby="standings-table-title"
          >
            <Kicker>Current standings</Kicker>
            <h2 id="standings-table-title">Order of Merit</h2>
            {standings.length === 0 ? (
              <p className="text-muted-foreground leading-[1.55]">
                No members are on the standings yet.
              </p>
            ) : (
              <div className="mt-5 border relative overflow-x-auto bg-card">
                <table className="w-full min-w-192 border-collapse text-left [&_tbody_th]:font-semibold [&_tbody_th]:text-primary! [&_tbody_th]:text-[1.125rem]! [&_tbody_tr:last-child_td]:border-b-0 [&_tbody_tr:last-child_th]:border-b-0 [&_td]:py-[0.9rem] [&_td]:px-3 [&_td]:border-b [&_td]:border-b-border/50 [&_td]:align-top [&_td]:text-[0.8125rem] [&_th]:py-[0.9rem] [&_th]:px-3 [&_th]:border-b [&_th]:border-b-border/50 [&_th]:align-top [&_th]:text-[0.8125rem] [&_thead_th]:text-muted-foreground [&_thead_th]:font-mono [&_thead_th]:text-[0.6875rem] [&_thead_th]:tracking-[0.08em] [&_thead_th]:uppercase">
                  <caption className="sr-only">Current group standings</caption>
                  <thead>
                    <tr>
                      <th scope="col">Rank</th>
                      <th scope="col">Player</th>
                      <th scope="col">Merit</th>
                      <th scope="col">Rounds</th>
                      <th scope="col">Quota</th>
                    </tr>
                  </thead>
                  <tbody>
                    {standings.map((row) => (
                      <tr key={row.membership_id}>
                        <th scope="row">{row.standing_rank ?? "—"}</th>
                        <td>
                          {[row.first_name, row.last_name]
                            .filter(Boolean)
                            .join(" ") || "Unnamed player"}
                        </td>
                        <td>{row.merit_total ?? "0"}</td>
                        <td>{row.rounds_played}</td>
                        <td>{row.projected_quota ?? "Not available"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="text-muted-foreground leading-[1.55]">
              The reset date only affects rounds played and Order of Merit
              totals.
            </p>
          </section>
          <section
            className="mt-10 pt-8 border-t [&>h2]:mx-0 [&>h2]:text-[1.5rem] [&>h2]:font-semibold [&>h2]:mt-1.5! [&>h2]:mb-0!"
            aria-labelledby="quota-history-title"
          >
            <Kicker>Your quota history</Kicker>
            <h2 id="quota-history-title">Your official rounds</h2>
            {history.length === 0 ? (
              <p className="text-muted-foreground leading-[1.55]">
                No completed rounds are in your quota history yet.
              </p>
            ) : (
              <div className="mt-5 border relative overflow-x-auto bg-card">
                <table className="w-full min-w-192 border-collapse text-left [&_tbody_th]:font-semibold [&_tbody_th]:text-primary! [&_tbody_th]:text-[1.125rem]! [&_tbody_tr:last-child_td]:border-b-0 [&_tbody_tr:last-child_th]:border-b-0 [&_td]:py-[0.9rem] [&_td]:px-3 [&_td]:border-b [&_td]:border-b-border/50 [&_td]:align-top [&_td]:text-[0.8125rem] [&_th]:py-[0.9rem] [&_th]:px-3 [&_th]:border-b [&_th]:border-b-border/50 [&_th]:align-top [&_th]:text-[0.8125rem] [&_thead_th]:text-muted-foreground [&_thead_th]:font-mono [&_thead_th]:text-[0.6875rem] [&_thead_th]:tracking-[0.08em] [&_thead_th]:uppercase">
                  <caption className="sr-only">Your quota history</caption>
                  <thead>
                    <tr>
                      <th scope="col">Date</th>
                      <th scope="col">Round</th>
                      <th scope="col">Points</th>
                      <th scope="col">Plus/minus</th>
                      <th scope="col">Quota after</th>
                      <th scope="col">Counts toward standings</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((row) => (
                      <tr key={row.history_id}>
                        <th scope="row">
                          {new Intl.DateTimeFormat("en-US", {
                            dateStyle: "medium",
                          }).format(new Date(row.completed_at))}
                        </th>
                        <td>
                          <TextLink
                            href={`/member/results?round_id=${row.round_id}`}
                          >
                            {row.round_description ?? "Completed round"}
                          </TextLink>
                        </td>
                        <td>{row.point_total}</td>
                        <td>{row.plus_minus ?? "Not applicable"}</td>
                        <td>{row.quota_after}</td>
                        <td>
                          {row.counts_in_standings ? "Yes" : "History only"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </section>
      </main>
    </>
  );
}

function MemberStandingsUnavailable() {
  return (
    <>
      <SkipLink />
      <main id="main-content" tabIndex={-1} className={standalonePageWideClass}>
        <section className={standalonePanelClass} data-slot="auth-ledger">
          <Kicker>Standings and history</Kicker>
          <h1>We couldn&apos;t load your standings</h1>
          <p>Try again in a moment or ask a group coordinator for help.</p>
          <TextLink href="/member/home">Return to your home</TextLink>
        </section>
      </main>
    </>
  );
}
