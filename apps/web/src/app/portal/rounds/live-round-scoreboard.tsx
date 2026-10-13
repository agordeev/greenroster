import { EmptyState, SectionHeading } from "@/components/blocks";
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
      className="mt-10 pt-8 border-t [&>h2]:mx-0 [&>h2]:text-[1.5rem] [&>h2]:font-semibold [&>h2]:mt-1.5! [&>h2]:mb-0! [&_[data-slot=round-detail-table-wrap]_table]:min-w-240 [&_tr[data-score-state='confirmed']_td:last-child]:font-bold [&_tr[data-score-state='confirmed']_td:last-child]:text-primary! [&_tr[data-score-state='locked']_td:last-child]:text-destructive [&_tr[data-score-state='missing']_td:last-child]:text-destructive"
      aria-labelledby="live-scoreboard-title"
    >
      <SectionHeading
        kicker="Round day"
        title="Live scorecard"
        titleId="live-scoreboard-title"
        meta={
          lastConfirmedAt
            ? `Updated ${formatTime(lastConfirmedAt)}`
            : "No scores yet"
        }
      />
      <p>
        Missing means no score yet, not zero. Refresh the page if a score looks
        out of date.
      </p>
      {participants.length === 0 ? (
        <EmptyState>No players are available to score yet.</EmptyState>
      ) : (
        <div
          className="mt-8 max-w-full overflow-x-auto [overscroll-behavior-inline:contain] [&_h3]:m-0 [&_h3]:text-[1.125rem] [&_h3]:font-semibold [&_table]:min-w-184 [&_table]:border-collapse [&_td]:p-3 [&_td]:border-b [&_td]:border-b-border/50 [&_td]:text-left [&_td]:whitespace-nowrap [&_td]:text-muted-foreground [&_td]:text-[0.8125rem] [&_th]:p-3 [&_th]:border-b [&_th]:border-b-border/50 [&_th]:text-left [&_th]:whitespace-nowrap [&_th]:text-muted-foreground [&_th]:font-mono [&_th]:text-[0.6875rem] [&_th]:tracking-[0.05em] [&_th]:uppercase"
          data-slot="round-detail-table-wrap"
        >
          <table>
            <caption className="sr-only">Live scorecard</caption>
            <thead>
              <tr>
                <th scope="col">Player</th>
                <th scope="col">RSVP</th>
                <th scope="col">Points</th>
                <th scope="col">Plus/minus</th>
                <th scope="col">Gross</th>
                <th scope="col">Net</th>
                <th scope="col">Status</th>
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
  const displayName = name || "Unnamed player";
  const playerLabel =
    participant.participantKind === "guest"
      ? `${displayName} · Guest`
      : displayName;
  const scoreState =
    participant.rsvpStatus !== "playing"
      ? "Locked"
      : participant.score.version === 0
        ? "Missing"
        : "Saved";

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
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}
