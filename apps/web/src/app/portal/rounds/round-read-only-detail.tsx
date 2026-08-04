import Link from "next/link";

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
    <section className="group-roles-panel" aria-labelledby="round-detail-title">
      <div className="group-panel-heading">
        <div>
          <p className="ledger-kicker">Round detail</p>
          <h2 id="round-detail-title">
            {detail.description || "Untitled round"}
          </h2>
        </div>
        <p>
          {formatRoundState(detail.state)} · Version {detail.version}
        </p>
      </div>

      <nav aria-label="Round detail sections" className="information-actions">
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
        <h3 id="round-detail-overview-title">Published configuration</h3>
        <dl className="publication-summary round-detail-summary">
          <SummaryItem label="State" value={formatRoundState(detail.state)} />
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
            value={`${detail.counts.playing} Playing · ${detail.counts.notPlaying} Not playing · ${detail.counts.noResponse} No response · ${detail.counts.guests} Guests`}
          />
          <SummaryItem
            label="Notes visibility"
            value={
              detail.notesVisibleToPlayers
                ? "Visible to players"
                : "Coordinator-only"
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
          <p className="ledger-kicker">Rule snapshot</p>
          <h3 id="round-detail-rule-snapshot-title">Published rule values</h3>
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
                label="Quota precision"
                value={
                  detail.ruleSnapshot.quotaPrecision === null
                    ? "Not configured"
                    : String(detail.ruleSnapshot.quotaPrecision)
                }
              />
              <SummaryItem
                label="Settings version"
                value={String(detail.ruleSnapshot.settingsVersion)}
              />
            </dl>
          ) : (
            <p className="group-empty" role="status">
              No immutable rule snapshot was recorded for this round.
            </p>
          )}
        </section>

        {detail.state === "cancelled" ? (
          <aside className="form-message error" role="status">
            <strong>Cancellation reason:</strong>{" "}
            {detail.cancellationReason || "No reason recorded."}
          </aside>
        ) : null}
      </section>

      <section
        id="round-detail-players"
        aria-labelledby="round-detail-players-title"
      >
        <p className="ledger-kicker">Players</p>
        <h3 id="round-detail-players-title">Immutable publication snapshots</h3>
        <p>
          Quota, handicap, tee, RSVP, and participant version values below are
          the server-confirmed round records. Later member changes do not alter
          these snapshots.
        </p>
        {detail.participants.length === 0 ? (
          <p className="group-empty" role="status">
            No participants were published for this round.
          </p>
        ) : (
          <div className="publication-member-list round-detail-table-wrap">
            <table>
              <caption className="visually-hidden">Round participants</caption>
              <thead>
                <tr>
                  <th scope="col">Player</th>
                  <th scope="col">Type</th>
                  <th scope="col">RSVP</th>
                  <th scope="col">Quota snapshot</th>
                  <th scope="col">Handicap snapshot</th>
                  <th scope="col">Tee snapshot</th>
                  <th scope="col">Version</th>
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
      return "Not configured";
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
