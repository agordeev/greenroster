import { redirect } from "next/navigation";
import Link from "next/link";
import { z } from "zod";

import {
  executeReadMemberOfficialResults,
  type MemberOfficialResult,
} from "@/lib/rounds/member-results-data";
import { resolveMemberPageSession } from "@/lib/auth/member-page-session";
import { signInPath } from "@/lib/auth/safe-return-path";

const roundIdSchema = z.uuid();

type MemberResultsPageProps = Readonly<{
  searchParams: Promise<{ round_id?: string | string[] }>;
}>;

export default async function MemberResultsPage({
  searchParams,
}: MemberResultsPageProps) {
  const params = await searchParams;
  const rawRoundId = Array.isArray(params.round_id)
    ? params.round_id[0]
    : params.round_id;
  const roundId = roundIdSchema.safeParse(rawRoundId);
  const returnPath = roundId.success
    ? `/member/results?round_id=${roundId.data}`
    : "/member/results";

  const access = await resolveMemberPageSession();
  if (access.state === "authentication_required") {
    redirect(signInPath(returnPath));
  }
  if (access.state === "recovery_active") redirect("/reset-password");
  if (access.state === "role_redirect") redirect("/portal");
  if (access.state !== "ready") return <MemberResultsUnavailable />;

  if (!roundId.success) return <MemberResultsUnavailable />;

  let data: Awaited<ReturnType<typeof executeReadMemberOfficialResults>>;
  try {
    data = await executeReadMemberOfficialResults(access.userId, roundId.data);
  } catch {
    return <MemberResultsUnavailable />;
  }
  return <MemberResultsContent round={data.round} results={data.results} />;
}

function MemberResultsContent({
  round,
  results,
}: Readonly<{
  round: Awaited<ReturnType<typeof executeReadMemberOfficialResults>>["round"];
  results: MemberOfficialResult[];
}>) {
  const ranked = results.filter((result) => result.competition_rank !== null);
  const winnerRank = ranked[0]?.competition_rank;
  const winners = winnerRank
    ? ranked.filter((result) => result.competition_rank === winnerRank)
    : [];
  const formatLabel =
    round.format === "individual_net" ? "Individual Net" : "Individual Gross";

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
          aria-labelledby="member-results-title"
        >
          <nav className="member-results-nav" aria-label="Member navigation">
            <Link className="secondary-link" href="/member/home">
              Home
            </Link>
            <Link className="secondary-link" href="/member/standings">
              Standings and history
            </Link>
            <Link className="secondary-link" href="/member/home#notifications">
              Notification preferences
            </Link>
            <Link className="secondary-link" href="/member/profile">
              Profile
            </Link>
          </nav>
          <p className="ledger-kicker">Official results</p>
          <h1 id="member-results-title">
            {round.description ?? "Completed round"}
          </h1>
          <p className="member-results-intro">
            {formatLabel} · Published{" "}
            {formatDate(
              results[0]?.completed_at ?? null,
              round.group_time_zone,
            )}
          </p>
          <p className="member-results-format-note">
            Ranked by{" "}
            {round.format === "individual_net" ? "plus/minus" : "golf points"}.
          </p>
          {winners.length > 0 ? (
            <section
              className="member-results-winner"
              aria-labelledby="winner-title"
            >
              <p className="ledger-kicker">Winner</p>
              <h2 id="winner-title">
                {winners.map(displayName).join(" and ")}
                {winners.length > 1 ? " (tied)" : ""}
              </h2>
            </section>
          ) : null}
          {results.length === 0 ? (
            <section className="member-home-empty" aria-live="polite">
              <h2>No results yet</h2>
              <p>This round is complete, but no results are available yet.</p>
            </section>
          ) : (
            <ResultsTable
              groupTimeZone={round.group_time_zone}
              results={results}
            />
          )}
        </section>
      </main>
    </>
  );
}

function ResultsTable({
  groupTimeZone,
  results,
}: Readonly<{
  groupTimeZone: string;
  results: MemberOfficialResult[];
}>) {
  return (
    <div className="member-results-table-wrap">
      <table className="member-results-table">
        <caption className="visually-hidden">Official round results</caption>
        <thead>
          <tr>
            <th scope="col">Rank</th>
            <th scope="col">Player</th>
            <th scope="col">RSVP</th>
            <th scope="col">Points</th>
            <th scope="col">Gross</th>
            <th scope="col">Net</th>
            <th scope="col">Quota</th>
            <th scope="col">Plus/minus</th>
            <th scope="col">Merit</th>
          </tr>
        </thead>
        <tbody>
          {results.map((result) => (
            <tr key={result.participant_id}>
              <th scope="row">{result.competition_rank ?? "—"}</th>
              <td>
                <strong>{displayName(result)}</strong>
                {result.participant_kind === "guest" ? (
                  <span className="member-results-guest">Guest</span>
                ) : null}
              </td>
              <td>
                {formatRsvp(result.rsvp_status)}
                <small className="member-results-meta">
                  {result.rsvp_changed_at
                    ? formatDate(result.rsvp_changed_at, groupTimeZone)
                    : "Time not available"}
                </small>
              </td>
              <td>{formatValue(result.golf_points)}</td>
              <td>{formatValue(result.gross_score)}</td>
              <td>{formatValue(result.net_score)}</td>
              <td>{formatValue(result.quota_snapshot)}</td>
              <td>{formatValue(result.plus_minus)}</td>
              <td>
                <span className="member-results-merit">
                  <span>
                    Participation {formatValue(result.participation_merit)}
                  </span>
                  <span>Placement {formatValue(result.placement_merit)}</span>
                  <span>Manual {formatValue(result.manual_merit)}</span>
                  <span>Total {formatValue(result.total_merit)}</span>
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatRsvp(value: MemberOfficialResult["rsvp_status"]) {
  return value === "no_response"
    ? "No response"
    : value === "not_playing"
      ? "Not playing"
      : "Playing";
}

function displayName(
  result: Pick<MemberOfficialResult, "first_name" | "last_name">,
): string {
  return (
    [result.first_name, result.last_name].filter(Boolean).join(" ") ||
    "Unnamed player"
  );
}

function formatValue(value: string | null): string {
  return value === null ? "Not applicable" : value;
}

function formatDate(value: string | null, timeZone: string): string {
  if (!value) return "time not available";
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  }).format(new Date(value));
}

function MemberResultsUnavailable() {
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
          <p className="ledger-kicker">Official results</p>
          <h1>These results are not available</h1>
          <Link className="secondary-link" href="/member/home">
            Return to your home
          </Link>
        </section>
      </main>
    </>
  );
}
