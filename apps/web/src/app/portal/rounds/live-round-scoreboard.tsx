import type { LiveRoundScoreParticipant } from "@/domain/round-score";

export function LiveRoundScoreboard({
  participants,
}: Readonly<{
  participants: readonly LiveRoundScoreParticipant[];
}>) {
  const lastConfirmedAt = participants
    .map((participant) => participant.score.changedAt)
    .filter((value): value is string => value !== null)
    .sort()
    .at(-1);

  return (
    <section
      className="group-roles-panel live-scoreboard"
      aria-labelledby="live-scoreboard-title"
    >
      <div className="group-panel-heading">
        <div>
          <p className="ledger-kicker">Round-day operations</p>
          <h2 id="live-scoreboard-title">Live scorecard</h2>
        </div>
        <p>
          {lastConfirmedAt
            ? `Updated ${formatTime(lastConfirmedAt)}`
            : "No scores yet"}
        </p>
      </div>
      <p>
        Values below are the server-confirmed projection. Missing scores stay
        visibly distinct from a confirmed zero; refresh after a reconnect or
        when a scorer reports a stale entry.
      </p>
      {participants.length === 0 ? (
        <p className="group-empty" role="status">
          No participants are available for live scoring.
        </p>
      ) : (
        <div className="publication-member-list round-detail-table-wrap">
          <table>
            <caption className="visually-hidden">Live scorecard</caption>
            <thead>
              <tr>
                <th scope="col">Player</th>
                <th scope="col">RSVP</th>
                <th scope="col">Points</th>
                <th scope="col">Plus/minus</th>
                <th scope="col">Gross</th>
                <th scope="col">Net</th>
                <th scope="col">Score state</th>
              </tr>
            </thead>
            <tbody>
              {participants.map((participant) => (
                <ScoreRow
                  key={participant.participantId}
                  participant={participant}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function ScoreRow({
  participant,
}: Readonly<{ participant: LiveRoundScoreParticipant }>) {
  const name = [participant.firstName, participant.lastName]
    .filter((value): value is string => Boolean(value?.trim()))
    .join(" ")
    .trim();
  const displayName = name || "Unnamed participant";
  const playerLabel =
    participant.participantKind === "guest"
      ? `${displayName} · Guest`
      : displayName;
  const scoreState =
    participant.rsvpStatus !== "playing"
      ? "Locked"
      : participant.score.version === 0
        ? "Missing"
        : "Confirmed";

  return (
    <tr data-score-state={scoreState.toLowerCase()}>
      <th scope="row">{playerLabel}</th>
      <td>{formatRsvp(participant.rsvpStatus)}</td>
      <td>{formatScore(participant.score.golfPoints)}</td>
      <td>{formatSignedScore(participant.score.plusMinus)}</td>
      <td>
        {participant.enabledFields.grossScore
          ? formatScore(participant.score.grossScore)
          : "Not available"}
      </td>
      <td>
        {participant.enabledFields.netScore
          ? formatScore(participant.score.netScore)
          : "Not available"}
      </td>
      <td>{scoreState}</td>
    </tr>
  );
}

function formatRsvp(status: LiveRoundScoreParticipant["rsvpStatus"]): string {
  switch (status) {
    case "playing":
      return "Playing";
    case "not_playing":
      return "Not playing";
    default:
      return "No response";
  }
}

function formatScore(value: string | null): string {
  return value === null ? "Missing" : value;
}

function formatSignedScore(value: string | null): string {
  if (value === null) return "Missing";
  return Number(value) > 0 ? `+${value}` : value;
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "recently";
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}
