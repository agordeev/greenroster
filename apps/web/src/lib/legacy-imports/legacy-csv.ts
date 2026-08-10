import { createHash } from "node:crypto";

const HEADER_PATTERN = /^[a-z][a-z0-9_.-]{0,127}$/u;
const SECRET_FIELD_PATTERN =
  /(?:password|passcode|token|secret|api[_-]?key|private[_-]?key|card(?:[_-]?number)?|cvv|cvc)/iu;

export const LEGACY_IMPORT_MAX_BYTES = 10 * 1024 * 1024;
export const LEGACY_IMPORT_MAX_ROWS = 50_000;

export type LegacyImportProfile = Readonly<{
  profileKey: string;
  schemaVersion: string;
  legacyTypeHeader: string;
  legacyKeyHeader: string;
  mappings: readonly Readonly<{
    sourceHeader: string;
    targetField: string;
  }>[];
}>;

export type LegacyImportProfileError = Readonly<{
  code: string;
  field?: string;
  message: string;
}>;

export type LegacyImportRow = Readonly<{
  rowNumber: number;
  legacyType: string;
  legacyKey: string;
  payload: Readonly<Record<string, string>>;
}>;

export type LegacyImportCsvError = Readonly<{
  code: string;
  column?: string;
  message: string;
  rowNumber?: number;
}>;

export type LegacyImportCsvWarning = Readonly<{
  code: string;
  column?: string;
  message: string;
  rowNumber?: number;
}>;

export type LegacyImportCsvParseResult =
  | Readonly<{
      ok: true;
      rows: readonly LegacyImportRow[];
      warnings: readonly LegacyImportCsvWarning[];
    }>
  | Readonly<{
      ok: false;
      errors: readonly LegacyImportCsvError[];
    }>;

export function validateLegacyImportProfile(
  raw: unknown,
):
  | { ok: true; profile: LegacyImportProfile }
  | { ok: false; errors: readonly LegacyImportProfileError[] } {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return {
      ok: false,
      errors: [
        {
          code: "profile_required",
          message: "Choose a legacy import profile.",
        },
      ],
    };
  }
  const value = raw as Record<string, unknown>;
  const errors: LegacyImportProfileError[] = [];
  const profileKey = text(value.profileKey);
  const schemaVersion = text(value.schemaVersion);
  const legacyTypeHeader = normalizeHeader(value.legacyTypeHeader);
  const legacyKeyHeader = normalizeHeader(value.legacyKeyHeader);
  if (!profileKey || !/^[a-z][a-z0-9_.-]{1,63}$/u.test(profileKey)) {
    errors.push({
      code: "profile_key_invalid",
      field: "profileKey",
      message: "Use a named source profile.",
    });
  }
  if (!schemaVersion || !/^[a-z0-9][a-z0-9._-]{0,31}$/iu.test(schemaVersion)) {
    errors.push({
      code: "schema_version_invalid",
      field: "schemaVersion",
      message: "Choose a source schema version.",
    });
  }
  if (!legacyTypeHeader || !HEADER_PATTERN.test(legacyTypeHeader)) {
    errors.push({
      code: "legacy_type_header_invalid",
      field: "legacyTypeHeader",
      message: "Choose the source column that identifies each row type.",
    });
  }
  if (!legacyKeyHeader || !HEADER_PATTERN.test(legacyKeyHeader)) {
    errors.push({
      code: "legacy_key_header_invalid",
      field: "legacyKeyHeader",
      message: "Choose the source column that identifies each row.",
    });
  }
  if (
    legacyTypeHeader &&
    legacyKeyHeader &&
    legacyTypeHeader === legacyKeyHeader
  ) {
    errors.push({
      code: "key_headers_duplicate",
      field: "legacyKeyHeader",
      message: "Use different columns for row type and row key.",
    });
  }
  const mappingsValue = value.mappings;
  if (!Array.isArray(mappingsValue) || mappingsValue.length === 0) {
    errors.push({
      code: "mappings_required",
      field: "mappings",
      message: "Map at least one source field before you stage a file.",
    });
  }
  const mappings: Array<{ sourceHeader: string; targetField: string }> = [];
  const sourceHeaders = new Set<string>();
  const targetFields = new Set<string>();
  for (const [index, item] of (Array.isArray(mappingsValue)
    ? mappingsValue
    : []
  ).entries()) {
    const record =
      item && typeof item === "object" && !Array.isArray(item)
        ? (item as Record<string, unknown>)
        : {};
    const sourceHeader = normalizeHeader(record.sourceHeader);
    const targetField = normalizeHeader(record.targetField);
    if (!sourceHeader || !HEADER_PATTERN.test(sourceHeader)) {
      errors.push({
        code: "source_header_invalid",
        field: `mappings.${index}.sourceHeader`,
        message: "Choose a valid source column.",
      });
      continue;
    }
    if (
      !targetField ||
      !HEADER_PATTERN.test(targetField) ||
      SECRET_FIELD_PATTERN.test(targetField)
    ) {
      errors.push({
        code: "target_field_invalid",
        field: `mappings.${index}.targetField`,
        message: "Choose a non-sensitive destination field.",
      });
      continue;
    }
    if (sourceHeaders.has(sourceHeader)) {
      errors.push({
        code: "source_header_duplicate",
        field: `mappings.${index}.sourceHeader`,
        message: "Map each source column once.",
      });
      continue;
    }
    if (targetFields.has(targetField)) {
      errors.push({
        code: "target_field_duplicate",
        field: `mappings.${index}.targetField`,
        message: "Map each destination field once.",
      });
      continue;
    }
    sourceHeaders.add(sourceHeader);
    targetFields.add(targetField);
    mappings.push({ sourceHeader, targetField });
  }
  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    profile: {
      profileKey: profileKey!,
      schemaVersion: schemaVersion!,
      legacyTypeHeader: legacyTypeHeader!,
      legacyKeyHeader: legacyKeyHeader!,
      mappings,
    },
  };
}

function parseRecords(
  source: string,
):
  | { ok: true; records: string[][] }
  | { ok: false; error: LegacyImportCsvError } {
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
          message: "You close a quoted value before the row ends.",
        },
      };
    }
    if (character === '"') {
      if (field !== "")
        return {
          ok: false,
          error: {
            code: "invalid_quote",
            message: "You start a quoted value with a quote.",
          },
        };
      quoted = true;
    } else if (character === ",") finishField();
    else if (character === "\n") finishRecord();
    else if (character === "\r") {
      if (source[index + 1] === "\n") index += 1;
      finishRecord();
    } else field += character;
  }
  if (quoted)
    return {
      ok: false,
      error: {
        code: "unclosed_quote",
        message: "You leave a quoted value open at the end of the CSV.",
      },
    };
  if (field !== "" || record.length > 0 || quoteClosed) finishRecord();
  return { ok: true, records };
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeHeader(value: unknown): string | null {
  const normalized = text(value)?.toLowerCase() ?? null;
  return normalized && HEADER_PATTERN.test(normalized)
    ? normalized
    : normalized;
}

function normalizedValue(value: string): string | null {
  const normalized = value.trim();
  return normalized ? normalized : null;
}

function redactedPayload(
  values: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(values)) {
    if (!SECRET_FIELD_PATTERN.test(key)) result[key] = value;
  }
  return result;
}

export function parseProfiledLegacyCsv(
  source: string,
  profile: LegacyImportProfile,
): LegacyImportCsvParseResult {
  const parsed = parseRecords(source.replace(/^\uFEFF/u, ""));
  if (!parsed.ok) return { ok: false, errors: [parsed.error] };
  const records = parsed.records.filter((record) =>
    record.some((value) => value.trim() !== ""),
  );
  if (records.length === 0)
    return {
      ok: false,
      errors: [
        { code: "empty_file", message: "You upload an empty CSV file." },
      ],
    };

  const headers = records[0].map((header) => header.trim().toLowerCase());
  const errors: LegacyImportCsvError[] = [];
  const warnings: LegacyImportCsvWarning[] = [];
  const duplicates = headers.filter(
    (header, index) => headers.indexOf(header) !== index,
  );
  for (const header of new Set(duplicates)) {
    errors.push({
      code: "duplicate_header",
      column: header,
      message: `You repeat the ${header} column.`,
    });
  }
  const requiredHeaders = new Set([
    profile.legacyTypeHeader,
    profile.legacyKeyHeader,
    ...profile.mappings.map((mapping) => mapping.sourceHeader),
  ]);
  for (const header of requiredHeaders) {
    if (!headers.includes(header))
      errors.push({
        code: "missing_header",
        column: header,
        message: `You do not include the ${header} column.`,
      });
  }
  for (const header of headers) {
    if (!requiredHeaders.has(header))
      warnings.push({
        code: "unmapped_header",
        column: header,
        message: `You leave the ${header} column unmapped, so you will not import it.`,
      });
  }
  if (errors.length > 0) return { ok: false, errors };

  const rows: LegacyImportRow[] = [];
  const seenKeys = new Map<string, number>();
  for (let recordIndex = 1; recordIndex < records.length; recordIndex += 1) {
    const record = records[recordIndex];
    const rowNumber = recordIndex + 1;
    if (record.length !== headers.length) {
      errors.push({
        code: "column_count",
        message: `You provide a different number of columns on row ${rowNumber} than in the header.`,
        rowNumber,
      });
      continue;
    }
    const sourceValues: Record<string, string> = {};
    headers.forEach((header, index) => {
      const value = normalizedValue(record[index]);
      if (value !== null) sourceValues[header] = value;
    });
    const legacyType = sourceValues[profile.legacyTypeHeader];
    const legacyKey = sourceValues[profile.legacyKeyHeader];
    if (!legacyType)
      errors.push({
        code: "legacy_type_required",
        column: profile.legacyTypeHeader,
        message: `You add a legacy row type on row ${rowNumber}.`,
        rowNumber,
      });
    if (!legacyKey)
      errors.push({
        code: "legacy_key_required",
        column: profile.legacyKeyHeader,
        message: `You add a legacy key on row ${rowNumber}.`,
        rowNumber,
      });
    if (!legacyType || !legacyKey) continue;
    if (legacyKey.length > 200 || /[\u0000-\u001F\u007F]/u.test(legacyKey)) {
      errors.push({
        code: "legacy_key_invalid",
        column: profile.legacyKeyHeader,
        message: `You use a valid legacy key on row ${rowNumber}.`,
        rowNumber,
      });
      continue;
    }
    const duplicateRow = seenKeys.get(`${legacyType}\u0000${legacyKey}`);
    if (duplicateRow !== undefined) {
      errors.push({
        code: "duplicate_legacy_key",
        column: profile.legacyKeyHeader,
        message: `You repeat the legacy key from row ${duplicateRow} on row ${rowNumber}.`,
        rowNumber,
      });
      continue;
    }
    seenKeys.set(`${legacyType}\u0000${legacyKey}`, rowNumber);
    const payload: Record<string, string> = {};
    for (const mapping of profile.mappings) {
      const value = sourceValues[mapping.sourceHeader];
      if (value !== undefined) payload[mapping.targetField] = value;
    }
    rows.push({
      rowNumber,
      legacyType,
      legacyKey,
      payload: redactedPayload(payload),
    });
  }
  return errors.length > 0
    ? { ok: false, errors }
    : { ok: true, rows, warnings };
}

export function fingerprintLegacyCsv(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
