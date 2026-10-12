import { redirect } from "next/navigation";
import Link from "next/link";

import {
  executeReadMemberQuotaHistory,
  executeReadMemberStandings,
} from "@/lib/rounds/member-results-data";
import { resolveMemberPageSession } from "@/lib/auth/member-page-session";
import { signInPath } from "@/lib/auth/safe-return-path";

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
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <main
        id="main-content"
        tabIndex={-1}
        className="auth-shell auth-shell-single invitation-shell"
      >
        <section
          className="auth-ledger member-results-page"
          aria-labelledby="member-standings-title"
        >
          <nav className="member-results-nav" aria-label="Member navigation">
            <Link className="secondary-link" href="/member/home">
              Home
            </Link>
            <Link className="secondary-link" href="/member/home#notifications">
              Notification preferences
            </Link>
            <Link className="secondary-link" href="/member/profile">
              Profile
            </Link>
          </nav>
          <p className="ledger-kicker">Standings and history</p>
          <h1 id="member-standings-title">
            {context?.group_name ?? "Your group"}
          </h1>
          <p className="member-results-intro">
            Order of Merit · counting from:{" "}
            {formatDate(context?.standings_reset_date ?? null)}
          </p>
          <section
            className="member-stats-summary"
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
            className="page-section"
            aria-labelledby="standings-table-title"
          >
            <p className="ledger-kicker">Current standings</p>
            <h2 id="standings-table-title">Order of Merit</h2>
            {standings.length === 0 ? (
              <p className="member-read-empty">
                No members are on the standings yet.
              </p>
            ) : (
              <div className="member-results-table-wrap">
                <table className="member-results-table">
                  <caption className="visually-hidden">
                    Current group standings
                  </caption>
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
            <p className="member-read-note">
              The reset date only affects rounds played and Order of Merit
              totals.
            </p>
          </section>
          <section
            className="page-section"
            aria-labelledby="quota-history-title"
          >
            <p className="ledger-kicker">Your quota history</p>
            <h2 id="quota-history-title">Your official rounds</h2>
            {history.length === 0 ? (
              <p className="member-read-empty">
                No completed rounds are in your quota history yet.
              </p>
            ) : (
              <div className="member-results-table-wrap">
                <table className="member-results-table">
                  <caption className="visually-hidden">
                    Your quota history
                  </caption>
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
                          <Link
                            className="secondary-link"
                            href={`/member/results?round_id=${row.round_id}`}
                          >
                            {row.round_description ?? "Completed round"}
                          </Link>
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
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <main
        id="main-content"
        tabIndex={-1}
        className="auth-shell auth-shell-single invitation-shell"
      >
        <section className="auth-ledger">
          <p className="ledger-kicker">Standings and history</p>
          <h1>We couldn&apos;t load your standings</h1>
          <p>Try again in a moment or ask a group coordinator for help.</p>
          <Link className="secondary-link" href="/member/home">
            Return to your home
          </Link>
        </section>
      </main>
    </>
  );
}
