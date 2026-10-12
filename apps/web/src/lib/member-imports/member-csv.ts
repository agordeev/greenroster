import { createHash } from "node:crypto";

export const MEMBER_CSV_REQUIRED_HEADERS = [
  "first_name",
  "last_name",
  "invited_email",
] as const;

export const MEMBER_CSV_OPTIONAL_HEADERS = [
  "spouse_first_name",
  "spouse_last_name",
  "secondary_email",
  "home_phone",
  "work_phone",
  "mobile_phone",
  "address_line1",
  "address_line2",
  "city",
  "state_region",
  "postal_code",
  "country",
  "tee_location",
  "dues_paid",
  "secondary_email_visible",
  "home_phone_visible",
  "work_phone_visible",
  "mobile_phone_visible",
  "address_listed",
  "initial_quota",
  "use_initial_quota",
  "handicap_id",
  "handicap",
  "handicap_as_of",
  ...Array.from({ length: 20 }, (_, index) => `seed_total_${index + 1}`),
] as const;

export const MEMBER_CSV_HEADERS = [
  ...MEMBER_CSV_REQUIRED_HEADERS,
  ...MEMBER_CSV_OPTIONAL_HEADERS,
] as const;

const headerSet = new Set<string>(MEMBER_CSV_HEADERS);
const booleanHeaders = new Set<string>([
  "dues_paid",
  "secondary_email_visible",
  "home_phone_visible",
  "work_phone_visible",
  "mobile_phone_visible",
  "address_listed",
  "use_initial_quota",
]);

export type MemberCsvRow = Readonly<{
  rowNumber: number;
  values: Readonly<Record<string, string | boolean | null>>;
}>;

export type MemberCsvError = Readonly<{
  code: string;
  column?: string;
  message: string;
  rowNumber?: number;
}>;

export type MemberCsvParseResult =
  | Readonly<{ ok: true; rows: readonly MemberCsvRow[] }>
  | Readonly<{ ok: false; errors: readonly MemberCsvError[] }>;

function parseRecords(
  source: string,
): { ok: true; records: string[][] } | { ok: false; error: MemberCsvError } {
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let quoted = false;
  let quoteClosed = false;

  const finishField = () => {
    record.push(field);
    field = "";
    quoteClosed = false;
  };
  const finishRecord = () => {
    finishField();
    records.push(record);
    record = [];
  };

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];

    if (quoted) {
      if (character === '"') {
        if (source[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
          quoteClosed = true;
        }
      } else {
        field += character;
      }
      continue;
    }

    if (
      quoteClosed &&
      character !== "," &&
      character !== "\r" &&
      character !== "\n"
    ) {
      return {
        ok: false,
        error: {
          code: "invalid_quote",
          message:
            "Quoted fields cannot contain characters after the closing quote.",
        },
      };
    }

    if (character === '"') {
      if (field !== "") {
        return {
          ok: false,
          error: {
            code: "invalid_quote",
            message: "A quoted field must start with a quote.",
          },
        };
      }
      quoted = true;
    } else if (character === ",") {
      finishField();
    } else if (character === "\n") {
      finishRecord();
    } else if (character === "\r") {
      if (source[index + 1] === "\n") index += 1;
      finishRecord();
    } else {
      field += character;
    }
  }

  if (quoted) {
    return {
      ok: false,
      error: {
        code: "unclosed_quote",
        message: "The CSV contains an unclosed quoted field.",
      },
    };
  }

  if (field !== "" || record.length > 0 || quoteClosed) finishRecord();
  return { ok: true, records };
}

function normalizedText(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function normalizeBoolean(value: string): boolean | null | undefined {
  const normalized = value.trim().toLowerCase();
  if (normalized === "") return null;
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  return undefined;
}

function decimalToScaledInteger(value: string, precision: number): number {
  const unsigned = value.replace(/^[+-]/, "");
  const [whole, fraction = ""] = unsigned.split(".");
  const scaled = Number.parseInt(
    `${whole}${fraction.padEnd(precision, "0")}`,
    10,
  );
  return value.startsWith("-") ? -scaled : scaled;
}

function rowErrors(
  rowNumber: number,
  values: Readonly<Record<string, string | boolean | null>>,
): MemberCsvError[] {
  const errors: MemberCsvError[] = [];
  for (const header of MEMBER_CSV_REQUIRED_HEADERS) {
    if (values[header] == null) {
      errors.push({
        code: "required",
        column: header,
        message: `${header} is required.`,
        rowNumber,
      });
    }
  }

  const invitedEmail = values.invited_email;
  if (
    typeof invitedEmail === "string" &&
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(invitedEmail)
  ) {
    errors.push({
      code: "invalid_email",
      column: "invited_email",
      message: "invited_email must be a valid e-mail address.",
      rowNumber,
    });
  }

  const secondaryEmail = values.secondary_email;
  if (
    typeof secondaryEmail === "string" &&
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(secondaryEmail)
  ) {
    errors.push({
      code: "invalid_email",
      column: "secondary_email",
      message: "secondary_email must be a valid e-mail address.",
      rowNumber,
    });
  }

  const tee = values.tee_location;
  if (
    typeof tee === "string" &&
    !["pro", "back", "middle", "front"].includes(tee)
  ) {
    errors.push({
      code: "invalid_tee",
      column: "tee_location",
      message: "tee_location must be pro, back, middle, or front.",
      rowNumber,
    });
  }

  const decimalChecks: Array<[string, number, number, number]> = [
    ["initial_quota", 0, 100, 2],
    ["handicap", -10, 54, 1],
    ...Array.from(
      { length: 20 },
      (_, index) =>
        [`seed_total_${index + 1}`, 0, 100, 2] as [
          string,
          number,
          number,
          number,
        ],
    ),
  ];
  for (const [column, minimum, maximum, precision] of decimalChecks) {
    const value = values[column];
    if (typeof value !== "string") continue;
    const pattern =
      precision === 1 ? /^[+-]?\d+(?:\.\d)?$/ : /^[+]?\d+(?:\.\d{1,2})?$/;
    const scale = 10 ** precision;
    const validPattern = pattern.test(value);
    const scaled = validPattern ? decimalToScaledInteger(value, precision) : 0;
    if (!validPattern || scaled < minimum * scale || scaled > maximum * scale) {
      errors.push({
        code: "invalid_number",
        column,
        message: `${column} must be between ${minimum} and ${maximum} with at most ${precision} decimal places.`,
        rowNumber,
      });
    }
  }

  const handicapAsOf = values.handicap_as_of;
  if (
    typeof handicapAsOf === "string" &&
    !/^\d{4}-\d{2}-\d{2}$/.test(handicapAsOf)
  ) {
    errors.push({
      code: "invalid_date",
      column: "handicap_as_of",
      message: "handicap_as_of must use YYYY-MM-DD.",
      rowNumber,
    });
  }
  if (
    (values.handicap_id != null || handicapAsOf != null) &&
    values.handicap == null
  ) {
    errors.push({
      code: "handicap_value_required",
      column: "handicap",
      message:
        "handicap is required when handicap_id or handicap_as_of is filled in.",
      rowNumber,
    });
  }
  if (values.use_initial_quota === true && values.initial_quota == null) {
    errors.push({
      code: "initial_quota_required",
      column: "initial_quota",
      message: "initial_quota is required when use_initial_quota is true.",
      rowNumber,
    });
  }
  return errors;
}

export function parseMemberCsv(source: string): MemberCsvParseResult {
  const parsed = parseRecords(source.replace(/^\uFEFF/, ""));
  if (!parsed.ok) return { ok: false, errors: [parsed.error] };

  const records = parsed.records.filter((record) =>
    record.some((value) => value.trim() !== ""),
  );
  if (records.length === 0) {
    return {
      ok: false,
      errors: [{ code: "empty_file", message: "The CSV is empty." }],
    };
  }

  const headers = records[0].map((header) => header.trim().toLowerCase());
  const errors: MemberCsvError[] = [];
  const duplicates = headers.filter(
    (header, index) => headers.indexOf(header) !== index,
  );
  for (const header of new Set(duplicates)) {
    errors.push({
      code: "duplicate_header",
      column: header,
      message: `Duplicate header: ${header}.`,
    });
  }
  for (const header of headers) {
    if (!headerSet.has(header)) {
      errors.push({
        code: "unknown_header",
        column: header,
        message: `Unknown header: ${header}.`,
      });
    }
  }
  for (const header of MEMBER_CSV_REQUIRED_HEADERS) {
    if (!headers.includes(header)) {
      errors.push({
        code: "missing_header",
        column: header,
        message: `Missing header: ${header}.`,
      });
    }
  }
  if (errors.length > 0) return { ok: false, errors };

  const rows: MemberCsvRow[] = [];
  for (let recordIndex = 1; recordIndex < records.length; recordIndex += 1) {
    const record = records[recordIndex];
    const rowNumber = recordIndex + 1;
    if (record.length !== headers.length) {
      errors.push({
        code: "column_count",
        message: `Row ${rowNumber} has ${record.length} columns; expected ${headers.length}.`,
        rowNumber,
      });
      continue;
    }

    const values: Record<string, string | boolean | null> = {};
    for (let columnIndex = 0; columnIndex < headers.length; columnIndex += 1) {
      const header = headers[columnIndex];
      const rawValue = record[columnIndex];
      if (booleanHeaders.has(header)) {
        const booleanValue = normalizeBoolean(rawValue);
        if (booleanValue === undefined) {
          errors.push({
            code: "invalid_boolean",
            column: header,
            message: `${header} must be true, false, or blank.`,
            rowNumber,
          });
          values[header] = null;
        } else {
          values[header] = booleanValue;
        }
      } else {
        values[header] = normalizedText(rawValue);
      }
    }
    if (typeof values.invited_email === "string") {
      values.invited_email = values.invited_email.toLowerCase();
    }
    if (typeof values.secondary_email === "string") {
      values.secondary_email = values.secondary_email.toLowerCase();
    }
    if (typeof values.tee_location === "string") {
      values.tee_location = values.tee_location.toLowerCase();
    }
    errors.push(...rowErrors(rowNumber, values));
    rows.push({ rowNumber, values });
  }

  const normalizedEmails = new Map<string, number>();
  for (const row of rows) {
    const email = row.values.invited_email;
    if (typeof email !== "string") continue;
    const priorRow = normalizedEmails.get(email);
    if (priorRow !== undefined) {
      errors.push({
        code: "duplicate_email",
        column: "invited_email",
        message: `invited_email duplicates row ${priorRow}.`,
        rowNumber: row.rowNumber,
      });
    } else {
      normalizedEmails.set(email, row.rowNumber);
    }
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true, rows };
}

function escapeCsv(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

export function createMemberCsvTemplate(): string {
  return `${MEMBER_CSV_HEADERS.map(escapeCsv).join(",")}\r\n`;
}

export function fingerprintMemberCsv(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
