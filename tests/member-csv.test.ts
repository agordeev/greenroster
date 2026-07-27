import { describe, expect, it } from "vitest";

import {
  createMemberCsvTemplate,
  fingerprintMemberCsv,
  MEMBER_CSV_HEADERS,
  parseMemberCsv,
} from "../apps/web/src/lib/member-imports/member-csv";

describe("member CSV boundary", () => {
  it("publishes a deterministic template with every supported field", () => {
    const template = createMemberCsvTemplate();
    expect(template).toBe(`${MEMBER_CSV_HEADERS.join(",")}\r\n`);
    expect(template).toContain("handicap_id,handicap,handicap_as_of");
    expect(template).toContain("seed_total_20");
  });

  it("parses quoted UTF-8 fields, normalizes matching e-mails, and keeps display text", () => {
    const result = parseMemberCsv(
      '\uFEFFfirst_name,last_name,invited_email,address_line1,dues_paid,tee_location\r\n"Zoë","O""Neil", PERSON@Example.test ,"1 Main, Street",TRUE,Front\r\n',
    );
    expect(result).toEqual({
      ok: true,
      rows: [
        {
          rowNumber: 2,
          values: {
            address_line1: "1 Main, Street",
            dues_paid: true,
            first_name: "Zoë",
            invited_email: "person@example.test",
            last_name: 'O"Neil',
            tee_location: "front",
          },
        },
      ],
    });
  });

  it("reports all row errors and rejects duplicate normalized e-mails", () => {
    const result = parseMemberCsv(
      "first_name,last_name,invited_email,use_initial_quota,handicap_id\n" +
        "Alex,,A@example.test,true,H-1\n" +
        "Pat,Player,a@example.test,maybe,\n",
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.map((error) => error.code)).toEqual(
      expect.arrayContaining([
        "required",
        "initial_quota_required",
        "handicap_value_required",
        "invalid_boolean",
        "duplicate_email",
      ]),
    );
  });

  it("rejects unknown, duplicate, and missing headers before reading rows", () => {
    const result = parseMemberCsv("first_name,first_name,surprise\nA,B,C\n");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.map((error) => error.code)).toEqual(
      expect.arrayContaining([
        "duplicate_header",
        "unknown_header",
        "missing_header",
      ]),
    );
  });

  it("rejects malformed quoting and column counts", () => {
    expect(
      parseMemberCsv(
        'first_name,last_name,invited_email\n"Alex,Player,a@example.test',
      ),
    ).toMatchObject({
      ok: false,
      errors: [{ code: "unclosed_quote" }],
    });
    expect(
      parseMemberCsv("first_name,last_name,invited_email\nAlex,Player\n"),
    ).toMatchObject({
      ok: false,
      errors: [{ code: "column_count", rowNumber: 2 }],
    });
  });

  it("enforces exact numeric and date boundaries", () => {
    const result = parseMemberCsv(
      "first_name,last_name,invited_email,initial_quota,handicap,handicap_as_of,seed_total_1\n" +
        "Alex,Player,a@example.test,100.001,54.1,07/27/2026,-1\n",
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(
      result.errors.filter((error) => error.code === "invalid_number"),
    ).toHaveLength(3);
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        code: "invalid_date",
        column: "handicap_as_of",
      }),
    );
  });

  it("fingerprints the exact uploaded bytes", () => {
    expect(fingerprintMemberCsv(new TextEncoder().encode("a,b\r\n"))).toBe(
      "fbf6b30113a4b6418c623a96ed6844f17ef5751b908a16abaa919d0bcd6b7784",
    );
  });
});
