export const MEMBER_ROSTER_DEFAULT_PAGE_SIZE = 25;
export const MEMBER_ROSTER_MAX_PAGE_SIZE = 100;

export const memberRosterSortKeys = [
  "name",
  "status",
  "role",
  "dues",
  "tee",
  "handicap",
  "quota",
  "date_added",
  "invitation",
] as const;

export type MemberRosterSortKey = (typeof memberRosterSortKeys)[number];
export type MemberRosterSortDirection = "asc" | "desc";
export type MemberRosterDuesFilter = "paid" | "unpaid";

export type MemberRosterQuery = Readonly<{
  search: string;
  alphabet: string | null;
  status: "pending" | "active" | "inactive" | null;
  role: "member" | "coordinator" | "administrator" | null;
  dues: MemberRosterDuesFilter | null;
  sort: MemberRosterSortKey;
  direction: MemberRosterSortDirection;
  page: number;
  pageSize: number;
}>;

type QueryValue = string | readonly string[] | undefined;
export type MemberRosterSearchParams = Readonly<Record<string, QueryValue>>;

const memberStatuses = new Set<MemberRosterQuery["status"]>([
  "pending",
  "active",
  "inactive",
]);
const memberRoles = new Set<MemberRosterQuery["role"]>([
  "member",
  "coordinator",
  "administrator",
]);
const duesFilters = new Set<MemberRosterDuesFilter>(["paid", "unpaid"]);
const sortKeySet = new Set<MemberRosterSortKey>(memberRosterSortKeys);

function firstValue(value: QueryValue) {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * A membership detail link is actionable only when its record is present in
 * the currently loaded, authorized roster page.
 */
export function visibleMemberRosterSelection(
  requestedMembership: QueryValue,
  visibleMembershipIds: readonly string[],
) {
  const requested = firstValue(requestedMembership);
  return requested && visibleMembershipIds.includes(requested)
    ? requested
    : null;
}

export function memberRosterHasNoActiveMembers(
  query: MemberRosterQuery,
  activeCount: number,
  totalCount: number,
) {
  return (
    !memberRosterQueryHasFilters(query) && activeCount === 0 && totalCount > 0
  );
}

function parsePositiveInteger(value: QueryValue, fallback: number) {
  const candidate = firstValue(value);
  if (!candidate || !/^\d+$/.test(candidate)) return fallback;
  const parsed = Number(candidate);
  if (!Number.isSafeInteger(parsed) || parsed < 1) return fallback;
  return parsed;
}

export function parseMemberRosterQuery(
  searchParams: MemberRosterSearchParams,
): MemberRosterQuery {
  const rawSearch = firstValue(searchParams.search)?.trim() ?? "";
  const rawAlphabet = firstValue(searchParams.alphabet)?.trim().toUpperCase();
  const rawStatus = firstValue(searchParams.status);
  const rawRole = firstValue(searchParams.role);
  const rawDues = firstValue(searchParams.dues);
  const rawSort = firstValue(searchParams.sort);
  const rawDirection = firstValue(searchParams.direction);

  return {
    search: rawSearch.slice(0, 200),
    alphabet: rawAlphabet && /^[A-Z]$/.test(rawAlphabet) ? rawAlphabet : null,
    status:
      rawStatus && memberStatuses.has(rawStatus as MemberRosterQuery["status"])
        ? (rawStatus as NonNullable<MemberRosterQuery["status"]>)
        : null,
    role:
      rawRole && memberRoles.has(rawRole as MemberRosterQuery["role"])
        ? (rawRole as NonNullable<MemberRosterQuery["role"]>)
        : null,
    dues:
      rawDues && duesFilters.has(rawDues as MemberRosterDuesFilter)
        ? (rawDues as MemberRosterDuesFilter)
        : null,
    sort:
      rawSort && sortKeySet.has(rawSort as MemberRosterSortKey)
        ? (rawSort as MemberRosterSortKey)
        : "name",
    direction: rawDirection === "desc" ? "desc" : "asc",
    page: parsePositiveInteger(searchParams.page, 1),
    pageSize: Math.min(
      parsePositiveInteger(
        searchParams.pageSize,
        MEMBER_ROSTER_DEFAULT_PAGE_SIZE,
      ),
      MEMBER_ROSTER_MAX_PAGE_SIZE,
    ),
  };
}

export function memberRosterQueryHasFilters(query: MemberRosterQuery) {
  return Boolean(
    query.search || query.alphabet || query.status || query.role || query.dues,
  );
}

export function memberRosterTotalPages(
  totalCount: number,
  query: Pick<MemberRosterQuery, "pageSize">,
) {
  return Math.max(1, Math.ceil(totalCount / query.pageSize));
}

export type MemberRosterHrefOptions = Partial<MemberRosterQuery> & {
  membership?: string | null;
};

export function buildMemberRosterHref(
  query: MemberRosterQuery,
  options: MemberRosterHrefOptions = {},
) {
  const next = { ...query, ...options };
  const params = new URLSearchParams();
  if (next.search) params.set("search", next.search);
  if (next.alphabet) params.set("alphabet", next.alphabet);
  if (next.status) params.set("status", next.status);
  if (next.role) params.set("role", next.role);
  if (next.dues) params.set("dues", next.dues);
  if (next.sort !== "name") params.set("sort", next.sort);
  if (next.direction !== "asc") params.set("direction", next.direction);
  if (next.page !== 1) params.set("page", String(next.page));
  if (next.pageSize !== MEMBER_ROSTER_DEFAULT_PAGE_SIZE) {
    params.set("pageSize", String(next.pageSize));
  }
  if (options.membership) params.set("membership", options.membership);
  const queryString = params.toString();
  return queryString ? `/portal/members?${queryString}` : "/portal/members";
}

export function memberRosterRpcArgs(
  actorUserId: string,
  query: MemberRosterQuery,
): Readonly<Record<string, unknown>> {
  // Keep the RPC offset within JavaScript's exact integer range. The
  // authoritative total_count, not this technical bound, determines pages.
  const offset = Math.min(
    Number.MAX_SAFE_INTEGER,
    (query.page - 1) * query.pageSize,
  );
  return {
    p_actor_user_id: actorUserId,
    p_search: query.search || null,
    p_alphabet: query.alphabet,
    p_status: query.status,
    p_role: query.role,
    p_dues_paid:
      query.dues === "paid" ? true : query.dues === "unpaid" ? false : null,
    p_sort_key: query.sort,
    p_sort_direction: query.direction,
    p_limit: query.pageSize,
    p_offset: offset,
  };
}

export function sortDirectionFor(
  query: Pick<MemberRosterQuery, "sort" | "direction">,
  key: MemberRosterSortKey,
): MemberRosterSortDirection {
  return query.sort === key && query.direction === "asc" ? "desc" : "asc";
}
