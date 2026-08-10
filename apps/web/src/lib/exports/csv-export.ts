import "server-only";

import type {
  MemberOfficialResult,
  MemberOfficialRound,
  MemberStanding,
} from "../rounds/member-results-data";
import type { ManageableMemberRosterRow } from "../memberships/member-management";

const formulaPrefix = /^[=+\-@]/u;

/**
 * Keep exported cells safe when a member opens a CSV in a spreadsheet.
 * Values are always quoted and formula-like values receive a leading apostrophe.
 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  const safeText = formulaPrefix.test(text) ? `'${text}` : text;
  return `"${safeText.replaceAll('"', '""')}"`;
}

export function createCsv(
  columns: readonly string[],
  rows: readonly (readonly unknown[])[],
): string {
  const lines = [columns, ...rows].map((row) => row.map(csvCell).join(","));
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

export function createMemberRosterCsv(
  rows: readonly ManageableMemberRosterRow[],
): string {
  return createCsv(
    [
      "Membership ID",
      "First name",
      "Last name",
      "Status",
      "Role",
      "Dues paid",
      "Tee",
      "Handicap",
      "Handicap source",
      "Handicap as of",
      "Quota",
      "Quota effective at",
      "Date added",
      "Invitation",
    ],
    rows.map((row) => [
      row.membershipId,
      row.firstName,
      row.lastName,
      row.status,
      row.role,
      row.duesPaid ? "Yes" : "No",
      row.teeLocation,
      row.handicapValue,
      row.handicapSource,
      row.handicapAsOf,
      row.currentQuota,
      row.currentQuotaEffectiveAt,
      row.dateAdded,
      row.invitationState,
    ]),
  );
}

export function createStandingsCsv(rows: readonly MemberStanding[]): string {
  return createCsv(
    [
      "Membership ID",
      "First name",
      "Last name",
      "Standing rank",
      "Merit total",
      "Rounds played",
      "Projected quota",
      "Quota ready",
      "Quota history count",
    ],
    rows.map((row) => [
      row.membership_id,
      row.first_name,
      row.last_name,
      row.standing_rank,
      row.merit_total,
      row.rounds_played,
      row.projected_quota,
      row.quota_projection_ready ? "Yes" : "No",
      row.eligible_quota_count,
    ]),
  );
}

function resultName(result: MemberOfficialResult): string {
  return [result.first_name, result.last_name].filter(Boolean).join(" ");
}

export function createOfficialResultsCsv(
  round: MemberOfficialRound,
  rows: readonly MemberOfficialResult[],
): string {
  return createCsv(
    [
      "Round ID",
      "Round",
      "Format",
      "Scheduled at",
      "Completed at",
      "Participant ID",
      "Player",
      "Participant kind",
      "RSVP",
      "Rank",
      "Points",
      "Gross",
      "Net",
      "Quota",
      "Plus/minus",
      "Total merit",
    ],
    rows.map((row) => [
      round.id,
      round.description,
      round.format,
      round.scheduled_at,
      row.completed_at,
      row.participant_id,
      resultName(row),
      row.participant_kind,
      row.rsvp_status,
      row.competition_rank,
      row.golf_points,
      row.gross_score,
      row.net_score,
      row.quota_snapshot,
      row.plus_minus,
      row.total_merit,
    ]),
  );
}
