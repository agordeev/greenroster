import Link from "next/link";

import { EmptyState, SectionHeading } from "@/components/ui";

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
    <section className="page-section" aria-labelledby="round-detail-title">
      <SectionHeading
        kicker="Round detail"
        title={detail.description || "Untitled round"}
        titleId="round-detail-title"
        meta={formatRoundState(detail.state)}
      />

      <nav aria-label="Round detail sections" className="action-row">
        <a className="secondary-link" href="#round-detail-overview">
          Overview
        </a>
        <a className="secondary-link" href="#round-detail-players">
          Players
        </a>
      </nav>

      <section
        id="round-detail-overview"
        aria-labelledby="round-detail-overview-title"
      >
        <p className="ledger-kicker">Overview</p>
        <h3 id="round-detail-overview-title">Published details</h3>
        <dl className="publication-summary round-detail-summary">
          <SummaryItem label="Status" value={formatRoundState(detail.state)} />
          <SummaryItem
            label="Scheduled"
            value={`${formatRoundSchedule(detail.scheduledAt, detail.groupTimeZone)} (${detail.groupTimeZone})`}
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
              Open round URL
            </Link>
          </p>
        ) : null}

        <section aria-labelledby="round-detail-rule-snapshot-title">
          <p className="ledger-kicker">Rules</p>
          <h3 id="round-detail-rule-snapshot-title">Rules as published</h3>
          {detail.ruleSnapshot ? (
            <dl className="publication-summary round-detail-summary">
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
              <SummaryItem
                label="Rules changes"
                value={String(detail.ruleSnapshot.settingsVersion)}
              />
            </dl>
          ) : (
            <EmptyState>No rules were saved for this round.</EmptyState>
          )}
        </section>

        {detail.state === "cancelled" ? (
          <aside className="form-message error" role="status">
            <strong>Cancellation reason:</strong>{" "}
            {detail.cancellationReason || "No reason given."}
          </aside>
        ) : null}
      </section>

      <section
        id="round-detail-players"
        aria-labelledby="round-detail-players-title"
      >
        <p className="ledger-kicker">Players</p>
        <h3 id="round-detail-players-title">Players as published</h3>
        <p>
          Quota, handicap, tee, and RSVP below are locked as published. Later
          changes to a member’s profile don’t change them.
        </p>
        {detail.participants.length === 0 ? (
          <EmptyState>No players were published for this round.</EmptyState>
        ) : (
          <div className="publication-member-list round-detail-table-wrap">
            <table>
              <caption className="visually-hidden">Round players</caption>
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
