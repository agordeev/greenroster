import { EmptyState, SectionHeading } from "@/components/ui";
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
        className="page-section"
        aria-labelledby="official-results-unavailable-title"
      >
        <p className="ledger-kicker">Published results</p>
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
    <section className="page-section" aria-labelledby="official-results-title">
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
          className="member-results-winner"
          aria-labelledby="portal-winner-title"
        >
          <p className="ledger-kicker">Winner</p>
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
        <div className="member-results-table-wrap">
          <table className="member-results-table">
            <caption className="visually-hidden">
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
                      <span className="member-results-guest">Guest</span>
                    ) : null}
                  </td>
                  <td>
                    {formatRsvp(result.rsvp_status)}
                    <small className="member-results-meta">
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
                    <span className="member-results-merit">
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
