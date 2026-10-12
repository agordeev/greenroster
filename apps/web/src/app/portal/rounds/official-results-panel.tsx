import { EmptyState, Kicker, SectionHeading } from "@/components/blocks";
import type {
  MemberOfficialResult,
  MemberOfficialRound,
} from "@/lib/rounds/member-results-data";

export function OfficialResultsPanel({
  data,
  unavailable,
}: Readonly<{
  data: Readonly<{
    round: MemberOfficialRound;
    results: readonly MemberOfficialResult[];
  }> | null;
  unavailable: boolean;
}>) {
  if (unavailable || !data) {
    return (
      <section
        className="mt-10 pt-8 border-t [&>h2]:mx-0 [&>h2]:text-[1.5rem] [&>h2]:font-semibold [&>h2]:mt-1.5! [&>h2]:mb-0!"
        aria-labelledby="official-results-unavailable-title"
      >
        <Kicker>Published results</Kicker>
        <h2 id="official-results-unavailable-title">
          We couldn&apos;t load the official results
        </h2>
        <p>Refresh the page to see rankings, scores, and merit totals.</p>
      </section>
    );
  }

  const ranked = data.results.filter(
    (result) => result.competition_rank !== null,
  );
  const winnerRank = ranked[0]?.competition_rank ?? null;
  const winners = winnerRank
    ? ranked.filter((result) => result.competition_rank === winnerRank)
    : [];
  const formatLabel =
    data.round.format === "individual_net"
      ? "Individual Net"
      : "Individual Gross";

  return (
    <section
      className="mt-10 pt-8 border-t [&>h2]:mx-0 [&>h2]:text-[1.5rem] [&>h2]:font-semibold [&>h2]:mt-1.5! [&>h2]:mb-0!"
      aria-labelledby="official-results-title"
    >
      <SectionHeading
        kicker="Published results"
        title="Official results"
        titleId="official-results-title"
        meta={
          <>
            {data.results.length}{" "}
            {data.results.length === 1 ? "result" : "results"}
          </>
        }
      />
      <p>
        {formatLabel} · Published{" "}
        {formatDate(
          data.results[0]?.completed_at ?? null,
          data.round.group_time_zone,
        )}
        .
      </p>
      {winners.length > 0 ? (
        <aside
          className="mt-10 pt-8 border-t [&_h2]:mx-0 [&_h2]:mt-1.5 [&_h2]:mb-0 [&_h2]:text-[1.5rem] [&_h2]:font-semibold"
          aria-labelledby="portal-winner-title"
        >
          <Kicker>Winner</Kicker>
          <h3 id="portal-winner-title">
            {winners.map(displayName).join(" and ")} —{" "}
            {winners.length > 1
              ? `tied at rank ${winnerRank}`
              : `rank ${winnerRank}`}
          </h3>
        </aside>
      ) : null}
      {data.results.length === 0 ? (
        <EmptyState>This round is complete, but it has no results.</EmptyState>
      ) : (
        <div className="mt-5 border relative overflow-x-auto bg-card">
          <table className="w-full min-w-192 border-collapse text-left [&_tbody_th]:font-semibold [&_tbody_th]:text-primary! [&_tbody_th]:text-[1.125rem]! [&_tbody_tr:last-child_td]:border-b-0 [&_tbody_tr:last-child_th]:border-b-0 [&_td]:py-[0.9rem] [&_td]:px-3 [&_td]:border-b [&_td]:border-b-border/50 [&_td]:align-top [&_td]:text-[0.8125rem] [&_th]:py-[0.9rem] [&_th]:px-3 [&_th]:border-b [&_th]:border-b-border/50 [&_th]:align-top [&_th]:text-[0.8125rem] [&_thead_th]:text-muted-foreground [&_thead_th]:text-[0.6875rem] [&_thead_th]:tracking-[0.08em] [&_thead_th]:uppercase">
            <caption className="sr-only">
              Official results for {data.round.description || "completed round"}
            </caption>
            <thead>
              <tr>
                <th scope="col">Rank</th>
                <th scope="col">Player</th>
                <th scope="col">RSVP</th>
                <th scope="col">Points</th>
                <th scope="col">Gross</th>
                <th scope="col">Net</th>
                <th scope="col">Plus/minus</th>
                <th scope="col">Quota</th>
                <th scope="col">Merit</th>
              </tr>
            </thead>
            <tbody>
              {data.results.map((result) => (
                <tr key={result.participant_id}>
                  <th scope="row">{result.competition_rank ?? "—"}</th>
                  <td>
                    <strong>{displayName(result)}</strong>
                    {result.participant_kind === "guest" ? (
                      <span className="mt-1 block text-muted-foreground text-[0.6875rem] tracking-[0.08em] uppercase">
                        Guest
                      </span>
                    ) : null}
                  </td>
                  <td>
                    {formatRsvp(result.rsvp_status)}
                    <small className="mt-1 block text-muted-foreground text-[0.75rem]">
                      {result.rsvp_changed_at
                        ? formatDate(
                            result.rsvp_changed_at,
                            data.round.group_time_zone,
                          )
                        : "Time unavailable"}
                    </small>
                  </td>
                  <td>{formatValue(result.golf_points)}</td>
                  <td>{formatValue(result.gross_score)}</td>
                  <td>{formatValue(result.net_score)}</td>
                  <td>{formatValue(result.plus_minus)}</td>
                  <td>{formatValue(result.quota_snapshot)}</td>
                  <td>
                    <span className="gap-[0.2rem] grid text-muted-foreground whitespace-nowrap [&_span:last-child]:text-foreground [&_span:last-child]:font-bold">
                      <span>
                        Participation {formatValue(result.participation_merit)}
                      </span>
                      <span>
                        Placement {formatValue(result.placement_merit)}
                      </span>
                      <span>Manual {formatValue(result.manual_merit)}</span>
                      <span>Total {formatValue(result.total_merit)}</span>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function formatRsvp(value: MemberOfficialResult["rsvp_status"]) {
  return value === "no_response"
    ? "No response"
    : value === "not_playing"
      ? "Not playing"
      : "Playing";
}

function displayName(result: MemberOfficialResult) {
  const name = [result.first_name, result.last_name]
    .filter((value): value is string => Boolean(value?.trim()))
    .join(" ")
    .trim();
  return name || "Unnamed player";
}

function formatValue(value: string | null) {
  return value ?? "Not applicable";
}

function formatDate(value: string | null, timeZone: string) {
  if (!value) return "not available";
  try {
    return new Intl.DateTimeFormat("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone,
    }).format(new Date(value));
  } catch {
    return new Date(value).toLocaleString();
  }
}
