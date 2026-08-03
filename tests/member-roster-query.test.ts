import { describe, expect, it } from "vitest";

import {
  buildMemberRosterHref,
  memberRosterHasNoActiveMembers,
  memberRosterRpcArgs,
  parseMemberRosterQuery,
  sortDirectionFor,
  requestedMemberRosterSelection,
} from "../apps/web/src/domain/member-roster-query";
import {
  formatMemberRosterInitialQuotaUsage,
  formatMemberRosterQuotaProvenance,
} from "../apps/web/src/domain/member-roster-presentation";

describe("member roster query boundary", () => {
  it("allowlists filters and preserves the full search contract", () => {
    const query = parseMemberRosterQuery({
      search: `  ${"x".repeat(240)}  `,
      alphabet: "b",
      status: ["active", "inactive"],
      role: "administrator",
      dues: "paid",
      sort: "date_added",
      direction: "desc",
      page: "101",
      pageSize: "101",
    });

    expect(query.search).toHaveLength(200);
    expect(query.alphabet).toBe("B");
    expect(query.status).toBe("active");
    expect(query.role).toBe("administrator");
    expect(query.dues).toBe("paid");
    expect(query.sort).toBe("date_added");
    expect(query.direction).toBe("desc");
    expect(query.page).toBe(101);
    expect(query.pageSize).toBe(100);
  });

  it("falls back safely for unknown values and produces stable RPC arguments", () => {
    const query = parseMemberRosterQuery({
      alphabet: "?",
      status: "unknown",
      role: "owner",
      dues: "maybe",
      sort: "sql",
      direction: "sideways",
      page: "not-a-page",
      pageSize: "0",
    });

    expect(query).toMatchObject({
      alphabet: null,
      status: null,
      role: null,
      dues: null,
      sort: "name",
      direction: "asc",
      page: 1,
      pageSize: 25,
    });
    expect(memberRosterRpcArgs("user-1", query)).toEqual({
      p_actor_user_id: "user-1",
      p_search: null,
      p_alphabet: null,
      p_status: null,
      p_role: null,
      p_dues_paid: null,
      p_sort_key: "name",
      p_sort_direction: "asc",
      p_limit: 25,
      p_offset: 0,
    });
  });

  it("preserves filters and selected-member context in canonical links", () => {
    const query = parseMemberRosterQuery({
      search: "Ada Lovelace",
      status: "active",
      role: "member",
      dues: "unpaid",
      sort: "name",
      direction: "asc",
      page: "3",
      pageSize: "50",
    });

    expect(
      buildMemberRosterHref(query, {
        membership: "60000000-0000-4000-8000-000000000001",
      }),
    ).toBe(
      "/portal/members?search=Ada+Lovelace&status=active&role=member&dues=unpaid&page=3&pageSize=50&membership=60000000-0000-4000-8000-000000000001",
    );
    expect(sortDirectionFor(query, "name")).toBe("desc");
    expect(sortDirectionFor(query, "quota")).toBe("asc");
  });

  it("preserves valid copied member-detail identifiers across roster pages", () => {
    const visible = "60000000-0000-4000-8000-000000000001";
    expect(requestedMemberRosterSelection(visible)).toBe(visible);
    expect(
      requestedMemberRosterSelection("60000000-0000-4000-8000-000000000002"),
    ).toBe("60000000-0000-4000-8000-000000000002");
    expect(requestedMemberRosterSelection([visible, "ignored"])).toBe(visible);
    expect(requestedMemberRosterSelection("not-a-membership-id")).toBeNull();
  });

  it("distinguishes a roster with records but no active members", () => {
    const unfiltered = parseMemberRosterQuery({});
    expect(memberRosterHasNoActiveMembers(unfiltered, 0, 4)).toBe(true);
    expect(memberRosterHasNoActiveMembers(unfiltered, 1, 4)).toBe(false);
    expect(
      memberRosterHasNoActiveMembers(
        parseMemberRosterQuery({ status: "pending" }),
        0,
        4,
      ),
    ).toBe(false);
  });

  it("labels quota provenance without fabricating a missing current value", () => {
    expect(formatMemberRosterQuotaProvenance({ kind: "seed_history" })).toBe(
      "Seed history",
    );
    expect(
      formatMemberRosterQuotaProvenance({ kind: "official_history" }),
    ).toBe("Official history");
    expect(formatMemberRosterQuotaProvenance({ kind: "method_c_chain" })).toBe(
      "Method C chain",
    );
    expect(formatMemberRosterQuotaProvenance({ kind: "manual_override" })).toBe(
      "Manual override",
    );
    expect(formatMemberRosterQuotaProvenance({ kind: "not_ready" })).toBe(
      "Not ready",
    );
    expect(
      formatMemberRosterQuotaProvenance({ kind: "future_internal_kind" }),
    ).toBe("Not recorded");
    expect(formatMemberRosterQuotaProvenance(null)).toBeNull();
    expect(formatMemberRosterInitialQuotaUsage(true)).toBe(
      "Use initial quota: Enabled",
    );
    expect(formatMemberRosterInitialQuotaUsage(false)).toBe(
      "Use initial quota: Disabled",
    );
  });
});
