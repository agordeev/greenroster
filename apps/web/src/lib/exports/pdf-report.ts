import "server-only";

import type {
  MemberOfficialResult,
  MemberOfficialRound,
  MemberStanding,
} from "../rounds/member-results-data";
import type { ManageableMemberRosterRow } from "../memberships/member-management";

export type ReportMetadata = Readonly<{
  groupName: string;
  generatedAt: string;
  timeZone: string;
  reportingWindow: string;
  containsPrivateData: boolean;
}>;

type ReportTable = Readonly<{
  title: string;
  columns: readonly string[];
  rows: readonly (readonly unknown[])[];
}>;

/**
 * Build a small, dependency-free PDF for operational reports. The report is
 * deliberately plain and print-friendly; the server remains the source of
 * truth for every row and the PDF carries its reporting context in the header.
 */
export function createReportPdf(
  metadata: ReportMetadata,
  table: ReportTable,
): Uint8Array {
  const header = [
    table.title,
    `Group: ${metadata.groupName}`,
    `Generated: ${metadata.generatedAt}`,
    `Group time zone: ${metadata.timeZone}`,
    `Reporting window: ${metadata.reportingWindow}`,
    `Private data: ${metadata.containsPrivateData ? "Yes" : "No"}`,
    "",
  ];
  const rows = [
    table.columns,
    table.columns.map(() => "----------------"),
    ...table.rows,
  ];
  const lines = [...header, ...rows].map((row) =>
    Array.isArray(row)
      ? row.map((cell) => printable(cell)).join(" | ")
      : String(row),
  );
  return createPdfPages(lines);
}

function personName(
  firstName: string | null | undefined,
  lastName: string | null | undefined,
): string {
  return [firstName, lastName].filter(Boolean).join(" ");
}

function roundTitle(round: MemberOfficialRound): string {
  return round.description ?? "Round";
}

export function createMemberRosterPdf(
  metadata: ReportMetadata,
  rows: readonly ManageableMemberRosterRow[],
): Uint8Array {
  return createReportPdf(metadata, {
    title: "GreenRoster member list",
    columns: ["Member", "Status", "Role", "Dues", "Tee", "Handicap", "Quota"],
    rows: rows.map((row) => [
      personName(row.firstName, row.lastName),
      row.status,
      row.role,
      row.duesPaid ? "Paid" : "Unpaid",
      row.teeLocation ?? "-",
      row.handicapValue ?? "-",
      row.currentQuota ?? "-",
    ]),
  });
}

export function createStandingsPdf(
  metadata: ReportMetadata,
  rows: readonly MemberStanding[],
): Uint8Array {
  const resetDate = rows[0]?.standings_reset_date ?? "not configured";
  return createReportPdf(
    {
      ...metadata,
      reportingWindow: `${metadata.reportingWindow}; standings reset ${resetDate}`,
      containsPrivateData: false,
    },
    {
      title: "GreenRoster Order of Merit standings",
      columns: ["Rank", "Member", "Merit", "Rounds", "Projected quota"],
      rows: rows.map((row) => [
        row.standing_rank ?? "-",
        personName(row.first_name, row.last_name),
        row.merit_total ?? "0",
        row.rounds_played,
        row.projected_quota ?? "-",
      ]),
    },
  );
}

function resultRows(rows: readonly MemberOfficialResult[]) {
  return rows.map((row) => [
    personName(row.first_name, row.last_name),
    row.participant_kind,
    row.rsvp_status,
    row.competition_rank ?? "-",
    row.golf_points ?? "-",
    row.gross_score ?? "-",
    row.net_score ?? "-",
    row.quota_snapshot ?? "-",
    row.plus_minus ?? "-",
  ]);
}

export function createOfficialResultsPdf(
  metadata: ReportMetadata,
  round: MemberOfficialRound,
  rows: readonly MemberOfficialResult[],
): Uint8Array {
  return createReportPdf(
    {
      ...metadata,
      reportingWindow: `${roundTitle(round)} official results`,
      containsPrivateData: false,
    },
    {
      title: `GreenRoster official results: ${roundTitle(round)}`,
      columns: [
        "Player",
        "Kind",
        "RSVP",
        "Rank",
        "Points",
        "Gross",
        "Net",
        "Quota",
        "Plus/minus",
      ],
      rows: resultRows(rows),
    },
  );
}

export function createScorepadPdf(
  metadata: ReportMetadata,
  round: MemberOfficialRound,
  rows: readonly MemberOfficialResult[],
): Uint8Array {
  return createReportPdf(
    {
      ...metadata,
      reportingWindow: `${roundTitle(round)} score pad`,
      containsPrivateData: false,
    },
    {
      title: `GreenRoster points score pad: ${roundTitle(round)}`,
      columns: [
        "Player",
        "Gross",
        "Net",
        "Quota",
        "Plus/minus",
        "Points",
        "Official",
      ],
      rows: rows.map((row) => [
        personName(row.first_name, row.last_name),
        row.gross_score ?? "-",
        row.net_score ?? "-",
        row.quota_snapshot ?? "-",
        row.plus_minus ?? "-",
        row.golf_points ?? "-",
        round.state === "completed" ? "Yes" : "No",
      ]),
    },
  );
}

function printable(value: unknown): string {
  const text = String(value ?? "");
  return text
    .replaceAll("\u2013", "-")
    .replaceAll("\u2014", "-")
    .replaceAll("\u2018", "'")
    .replaceAll("\u2019", "'")
    .replaceAll("\u201c", '"')
    .replaceAll("\u201d", '"')
    .replaceAll(/[^\x20-\x7e\xa0-\xff]/gu, "?")
    .slice(0, 120);
}

function pdfLiteral(value: string): string {
  return printable(value)
    .replaceAll("\\", "\\\\")
    .replaceAll("(", "\\(")
    .replaceAll(")", "\\)");
}

function createPdfPages(lines: readonly string[]): Uint8Array {
  const linesPerPage = 45;
  const pageLines: string[][] = [];
  for (let index = 0; index < lines.length; index += linesPerPage) {
    pageLines.push(lines.slice(index, index + linesPerPage));
  }
  if (pageLines.length === 0) pageLines.push([]);

  const objects: string[] = [];
  objects.push("<< /Type /Catalog /Pages 2 0 R >>");
  const pageObjectIndexes = pageLines.map((_, index) => 4 + index * 2);
  objects.push(
    `<< /Type /Pages /Kids [${pageObjectIndexes.map((value) => `${value} 0 R`).join(" ")}] /Count ${pageLines.length} >>`,
  );
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");

  pageLines.forEach((page) => {
    const contentObjectIndex = objects.length + 2;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentObjectIndex} 0 R >>`,
    );
    const commands = ["BT", "/F1 10 Tf", "48 760 Td"];
    page.forEach((line, index) => {
      if (index > 0) commands.push("0 -15 Td");
      commands.push(`(${pdfLiteral(line)}) Tj`);
    });
    commands.push("ET");
    const stream = commands.join("\n");
    objects.push(
      `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    );
  });

  let pdf = "%PDF-1.4\n% GreenRoster report\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach((offset) => {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}
