import { redirect } from "next/navigation";
import { z } from "zod";

import {
  executeReadMemberOfficialResults,
  type MemberOfficialResult,
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
      <SkipLink />
      <main id="main-content" tabIndex={-1} className={standalonePageWideClass}>
        <section
          className={standalonePanelFullClass}
          data-slot="auth-ledger"
          aria-labelledby="member-results-title"
        >
          <MemberNav current="standings" />
          <Kicker>Official results</Kicker>
          <h1 id="member-results-title">
            {round.description ?? "Completed round"}
          </h1>
          <p className="text-muted-foreground leading-[1.55]">
            {formatLabel} · Published{" "}
            {formatDate(
              results[0]?.completed_at ?? null,
              round.group_time_zone,
            )}
          </p>
          <p className="mt-2 text-muted-foreground leading-[1.55] text-[0.875rem]">
            Ranked by{" "}
            {round.format === "individual_net" ? "plus/minus" : "golf points"}.
          </p>
          {winners.length > 0 ? (
            <section
              className="mt-10 pt-8 border-t [&_h2]:mx-0 [&_h2]:mt-1.5 [&_h2]:mb-0 [&_h2]:text-[1.5rem] [&_h2]:font-semibold"
              aria-labelledby="winner-title"
            >
              <Kicker>Winner</Kicker>
              <h2 id="winner-title">
                {winners.map(displayName).join(" and ")}
                {winners.length > 1 ? " (tied)" : ""}
              </h2>
            </section>
          ) : null}
          {results.length === 0 ? (
            <section
              className="mt-10 pt-8 border-t [&>p:not([data-slot=kicker])]:text-muted-foreground [&>p:not([data-slot=kicker])]:leading-[1.65] [&_h2]:mx-0 [&_h2]:mt-1.5 [&_h2]:mb-0 [&_h2]:text-[1.5rem] [&_h2]:font-semibold"
              aria-live="polite"
            >
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
    <div className="mt-5 border relative overflow-x-auto bg-card">
      <table className="w-full min-w-192 border-collapse text-left [&_tbody_th]:font-semibold [&_tbody_th]:text-primary! [&_tbody_th]:text-[1.125rem]! [&_tbody_tr:last-child_td]:border-b-0 [&_tbody_tr:last-child_th]:border-b-0 [&_td]:py-[0.9rem] [&_td]:px-3 [&_td]:border-b [&_td]:border-b-border/50 [&_td]:align-top [&_td]:text-[0.8125rem] [&_th]:py-[0.9rem] [&_th]:px-3 [&_th]:border-b [&_th]:border-b-border/50 [&_th]:align-top [&_th]:text-[0.8125rem] [&_thead_th]:text-muted-foreground [&_thead_th]:font-mono [&_thead_th]:text-[0.6875rem] [&_thead_th]:tracking-[0.08em] [&_thead_th]:uppercase">
        <caption className="sr-only">Official round results</caption>
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
                  <span className="mt-1 block text-muted-foreground font-mono text-[0.6875rem] tracking-[0.08em] uppercase">
                    Guest
                  </span>
                ) : null}
              </td>
              <td>
                {formatRsvp(result.rsvp_status)}
                <small className="mt-1 block text-muted-foreground text-[0.75rem]">
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
                <span className="gap-[0.2rem] grid text-muted-foreground whitespace-nowrap [&_span:last-child]:text-foreground [&_span:last-child]:font-bold">
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
      <SkipLink />
      <main id="main-content" tabIndex={-1} className={standalonePageWideClass}>
        <section className={standalonePanelClass} data-slot="auth-ledger">
          <Kicker>Official results</Kicker>
          <h1>These results are not available</h1>
          <TextLink href="/member/home">Return to your home</TextLink>
        </section>
      </main>
    </>
  );
}
