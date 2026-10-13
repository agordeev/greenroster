import Link from "next/link";

import {
  EmptyState,
  FormMessage,
  Kicker,
  SectionHeading,
} from "@/components/blocks";

import {
  formatParticipantRsvp,
  formatSnapshotValue,
  participantDisplayName,
  type RoundCoordinatorDetail,
  type RoundCoordinatorParticipant,
} from "@/domain/round-detail";
import {
  formatRoundFormat,
  formatRoundSchedule,
  formatRoundState,
} from "@/domain/round-drafts";

export function RoundReadOnlyDetail({
  detail,
}: Readonly<{ detail: RoundCoordinatorDetail }>) {
  return (
    <section
      className="mt-10 pt-8 border-t [&>h2]:mx-0 [&>h2]:text-[1.5rem] [&>h2]:font-semibold [&>h2]:mt-1.5! [&>h2]:mb-0!"
      aria-labelledby="round-detail-title"
    >
      <SectionHeading
        kicker="Round"
        title={detail.description || "Untitled round"}
        titleId="round-detail-title"
        meta={formatRoundState(detail.state)}
      />

      <nav
        aria-label="Round detail sections"
        className="mt-6 flex flex-wrap items-center gap-y-3 gap-x-5"
      >
        <a
          className="justify-self-start text-primary text-[0.875rem] font-bold underline-offset-[0.2em] focus-visible:outline-[3px] focus-visible:outline-solid focus-visible:outline-ring focus-visible:outline-offset-[3px]"
          data-slot="text-link"
          href="#round-detail-overview"
        >
          Overview
        </a>
        <a
          className="justify-self-start text-primary text-[0.875rem] font-bold underline-offset-[0.2em] focus-visible:outline-[3px] focus-visible:outline-solid focus-visible:outline-ring focus-visible:outline-offset-[3px]"
          data-slot="text-link"
          href="#round-detail-players"
        >
          Players
        </a>
      </nav>

      <section
        id="round-detail-overview"
        aria-labelledby="round-detail-overview-title"
      >
        <Kicker>Overview</Kicker>
        <h3 id="round-detail-overview-title">Details</h3>
        <dl className="mx-0 mt-6 mb-0 gap-3 grid grid-cols-6 max-[720px]:grid-cols-2 [&>div[data-warning='true']]:border-destructive [&>div[data-warning='true']_dd]:text-destructive [&>div]:p-3.5 [&>div]:border [&>div]:border-border/50 [&>div]:min-w-0 [&>div]:rounded-lg [&_dd]:mx-0 [&_dd]:mt-[0.35rem] [&_dd]:mb-0 [&_dd]:text-muted-foreground [&_dd]:text-[1.5rem] [&_dd]:wrap-anywhere [&_dt]:text-muted-foreground [&_dt]:font-mono [&_dt]:text-[0.6875rem] [&_dt]:tracking-[0.07em] [&_dt]:uppercase round-detail-summary">
          <SummaryItem label="Status" value={formatRoundState(detail.state)} />
          <SummaryItem
            label="Scheduled"
            value={`${formatRoundSchedule(detail.scheduledAt, detail.groupTimeZone)}`}
          />
          <SummaryItem label="Venue" value={detail.venue || "Not provided"} />
          <SummaryItem
            label="Format"
            value={formatRoundFormat(detail.format)}
          />
          <SummaryItem
            label="RSVP deadline"
            value={formatRoundSchedule(
              detail.rsvpDeadlineAt,
              detail.groupTimeZone,
            )}
          />
          <SummaryItem
            label="Players"
            value={`${detail.counts.playing} playing · ${detail.counts.notPlaying} not playing · ${detail.counts.noResponse} no response · ${detail.counts.guests} guests`}
          />
          <SummaryItem
            label="Players can see notes"
            value={
              detail.notesVisibleToPlayers ? "Yes" : "No, coordinators only"
            }
          />
          <SummaryItem label="Notes" value={detail.notes || "No notes"} />
        </dl>

        {detail.roundUrl ? (
          <p>
            <Link href={detail.roundUrl} rel="noreferrer" target="_blank">
              Open round link
            </Link>
          </p>
        ) : null}

        <section aria-labelledby="round-detail-rule-snapshot-title">
          <Kicker>Rules</Kicker>
          <h3 id="round-detail-rule-snapshot-title">Rules for this round</h3>
          {detail.ruleSnapshot ? (
            <dl className="mx-0 mt-6 mb-0 gap-3 grid grid-cols-6 max-[720px]:grid-cols-2 [&>div[data-warning='true']]:border-destructive [&>div[data-warning='true']_dd]:text-destructive [&>div]:p-3.5 [&>div]:border [&>div]:border-border/50 [&>div]:min-w-0 [&>div]:rounded-lg [&_dd]:mx-0 [&_dd]:mt-[0.35rem] [&_dd]:mb-0 [&_dd]:text-muted-foreground [&_dd]:text-[1.5rem] [&_dd]:wrap-anywhere [&_dt]:text-muted-foreground [&_dt]:font-mono [&_dt]:text-[0.6875rem] [&_dt]:tracking-[0.07em] [&_dt]:uppercase round-detail-summary">
              <SummaryItem
                label="Format"
                value={formatRoundFormat(detail.ruleSnapshot.format)}
              />
              <SummaryItem
                label="Quota method"
                value={formatQuotaMethod(detail.ruleSnapshot.quotaMethod)}
              />
              <SummaryItem
                label="Quota decimal places"
                value={
                  detail.ruleSnapshot.quotaPrecision === null
                    ? "Not set"
                    : String(detail.ruleSnapshot.quotaPrecision)
                }
              />
            </dl>
          ) : (
            <EmptyState>No rules were saved for this round.</EmptyState>
          )}
        </section>

        {detail.state === "cancelled" ? (
          <FormMessage role="status">
            <strong>Cancellation reason:</strong>{" "}
            {detail.cancellationReason || "No reason given."}
          </FormMessage>
        ) : null}
      </section>

      <section
        id="round-detail-players"
        aria-labelledby="round-detail-players-title"
      >
        <Kicker>Players</Kicker>
        <h3 id="round-detail-players-title">Players</h3>
        {detail.participants.length === 0 ? (
          <EmptyState>This round has no players.</EmptyState>
        ) : (
          <div
            className="mt-8 max-w-full overflow-x-auto [overscroll-behavior-inline:contain] [&_h3]:m-0 [&_h3]:text-[1.125rem] [&_h3]:font-semibold [&_table]:min-w-184 [&_table]:border-collapse [&_td]:p-3 [&_td]:border-b [&_td]:border-b-border/50 [&_td]:text-left [&_td]:whitespace-nowrap [&_td]:text-muted-foreground [&_td]:text-[0.8125rem] [&_th]:p-3 [&_th]:border-b [&_th]:border-b-border/50 [&_th]:text-left [&_th]:whitespace-nowrap [&_th]:text-muted-foreground [&_th]:font-mono [&_th]:text-[0.6875rem] [&_th]:tracking-[0.05em] [&_th]:uppercase"
            data-slot="round-detail-table-wrap"
          >
            <table>
              <caption className="sr-only">Round players</caption>
              <thead>
                <tr>
                  <th scope="col">Player</th>
                  <th scope="col">Type</th>
                  <th scope="col">RSVP</th>
                  <th scope="col">Quota</th>
                  <th scope="col">Handicap</th>
                  <th scope="col">Tee</th>
                  <th scope="col">Changes</th>
                </tr>
              </thead>
              <tbody>
                {detail.participants.map((participant) => (
                  <PlayerRow
                    key={participant.participantId}
                    participant={participant}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </section>
  );
}

function formatQuotaMethod(
  method: NonNullable<RoundCoordinatorDetail["ruleSnapshot"]>["quotaMethod"],
): string {
  switch (method) {
    case "moving_average":
      return "Moving average";
    case "best_10_of_20":
      return "Best 10 of 20";
    case "previous_plus_minus":
      return "Previous plus/minus";
    default:
      return "Not set";
  }
}

function SummaryItem({
  label,
  value,
}: Readonly<{ label: string; value: string }>) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function PlayerRow({
  participant,
}: Readonly<{ participant: RoundCoordinatorParticipant }>) {
  return (
    <tr>
      <th scope="row">{participantDisplayName(participant)}</th>
      <td>{participant.participantKind === "guest" ? "Guest" : "Member"}</td>
      <td>{formatParticipantRsvp(participant.rsvpStatus)}</td>
      <td>{formatSnapshotValue(participant.quotaSnapshot)}</td>
      <td>{formatSnapshotValue(participant.handicapSnapshot)}</td>
      <td>{formatSnapshotValue(participant.teeSnapshot)}</td>
      <td>{participant.version}</td>
    </tr>
  );
}
