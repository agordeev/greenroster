"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import type { ChangeEvent, FormEvent } from "react";

import {
  changeMemberRoleAction,
  editMemberAction,
  setMemberHandicapAction,
  setMemberStatusAction,
} from "@/app/actions/memberships";
import {
  canChangeMemberRole,
  memberHandicapFingerprint,
  memberTargetPermissions,
  memberProfileFingerprint,
  memberRoleFingerprint,
  memberStatusFingerprint,
  retainMemberOperationId,
  shouldAllowMemberFormSubmit,
} from "@/lib/memberships/member-management";
import { shouldAllowDirtyNavigation } from "@/lib/groups/quota-settings-form-rules";
import { FieldHelp, FormMessage, TextLink } from "@/components/blocks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  buildMemberRosterHref,
  memberRosterHasNoActiveMembers,
  memberRosterQueryHasFilters,
  memberRosterTotalPages,
  sortDirectionFor,
  type MemberRosterQuery,
  type MemberRosterSortKey,
} from "@/domain/member-roster-query";
import { formatMemberRosterQuotaProvenance } from "@/domain/member-roster-presentation";
import type {
  ManageableMember,
  ManageableMemberRosterRow,
  MemberEditInput,
  MemberHandicapInput,
  MemberPrivateContact,
  MemberRoleInput,
} from "@/lib/memberships/member-management";

export type MemberEditorTab = "details" | "handicap" | "access";

type EditorValues = Omit<
  MemberEditInput,
  | "membershipId"
  | "expectedProfileVersion"
  | "expectedContactVersion"
  | "expectedMembershipVersion"
  | "operationId"
>;

const emptyContact: MemberPrivateContact = {
  membershipId: "",
  groupId: "",
  contactExists: false,
  contactVersion: 0,
  secondaryEmail: null,
  homePhone: null,
  workPhone: null,
  mobilePhone: null,
  addressLine1: null,
  addressLine2: null,
  city: null,
  stateRegion: null,
  postalCode: null,
  country: null,
  secondaryEmailVisible: false,
  homePhoneVisible: false,
  workPhoneVisible: false,
  mobilePhoneVisible: false,
  addressListed: false,
};

export function MemberManagement({
  actorMembershipId,
  activeCount,
  editorTab,
  members,
  privateContact,
  role,
  rosterQuery,
  selectedMember,
  totalCount,
}: Readonly<{
  actorMembershipId: string;
  activeCount: number;
  editorTab: MemberEditorTab | null;
  members: readonly ManageableMemberRosterRow[];
  privateContact: MemberPrivateContact | null;
  role: "member" | "coordinator" | "administrator";
  rosterQuery: MemberRosterQuery;
  selectedMember: ManageableMember | null;
  totalCount: number;
}>) {
  const [terminal, setTerminal] = useState<{
    membershipId: string | null;
    message: string;
    status: "success" | "error";
  }>({ membershipId: null, message: "", status: "error" });
  const terminalMessage =
    terminal.membershipId === (selectedMember?.membershipId ?? null)
      ? terminal.message
      : "";

  function showTerminalMessage(status: "success" | "error", message: string) {
    setTerminal({
      membershipId: selectedMember?.membershipId ?? null,
      message,
      status,
    });
  }

  return (
    <div className="mt-8 grid gap-6 [&>*]:min-w-0">
      {selectedMember ? null : (
        <section aria-label="Group members">
          <MemberRosterFilters query={rosterQuery} />
          <MemberRosterContent
            activeCount={activeCount}
            members={members}
            query={rosterQuery}
            selectedMemberId={null}
            totalCount={totalCount}
          />
        </section>
      )}

      {selectedMember && editorTab ? (
        <MemberEditor
          tab={editorTab}
          key={`${selectedMember.membershipId}:${selectedMember.membershipVersion}:${selectedMember.profileVersion}:${privateContact?.contactVersion ?? 0}`}
          actorMembershipId={actorMembershipId}
          member={selectedMember}
          privateContact={privateContact ?? emptyContact}
          role={role}
          onTerminalMessage={showTerminalMessage}
        />
      ) : null}
      <FormMessage
        tone={terminal.status === "success" ? "success" : "error"}
        aria-live="polite"
        data-status={terminalMessage ? terminal.status : undefined}
      >
        {terminalMessage}
      </FormMessage>
    </div>
  );
}

function MemberRosterFilters({
  query,
}: Readonly<{ query: MemberRosterQuery }>) {
  // Selects apply as soon as they change; search applies on Enter.
  function applyOnChange(event: ChangeEvent<HTMLSelectElement>) {
    event.currentTarget.form?.requestSubmit();
  }

  return (
    <form
      className="flex flex-wrap items-center gap-3"
      action="/portal/members"
      method="get"
      role="search"
    >
      <Input
        className="min-w-0 flex-[3_1_18rem]"
        name="search"
        type="search"
        aria-label="Search members"
        placeholder="Name, e-mail or Handicap ID"
        defaultValue={query.search}
        maxLength={200}
        autoComplete="off"
      />
      <NativeSelect
        className="w-auto flex-[1_1_9rem]"
        name="status"
        aria-label="Status"
        defaultValue={query.status ?? ""}
        onChange={applyOnChange}
      >
        <option value="">All statuses</option>
        <option value="pending">Pending</option>
        <option value="active">Active</option>
        <option value="inactive">Inactive</option>
      </NativeSelect>
      <NativeSelect
        className="w-auto flex-[1_1_9rem]"
        name="role"
        aria-label="Role"
        defaultValue={query.role ?? ""}
        onChange={applyOnChange}
      >
        <option value="">All roles</option>
        <option value="member">Member</option>
        <option value="coordinator">Coordinator</option>
        <option value="administrator">Administrator</option>
      </NativeSelect>
      <NativeSelect
        className="w-auto flex-[1_1_9rem]"
        name="dues"
        aria-label="Dues"
        defaultValue={query.dues ?? ""}
        onChange={applyOnChange}
      >
        <option value="">All dues</option>
        <option value="paid">Paid</option>
        <option value="unpaid">Not set yet</option>
      </NativeSelect>
      <RosterQueryFields query={query} keep={["sort", "pageSize"]} />
      <Button variant="outline" type="submit">
        Search
      </Button>
      {memberRosterQueryHasFilters(query) ? (
        <TextLink
          className="self-center"
          href={buildMemberRosterHref(query, {
            search: "",
            alphabet: null,
            status: null,
            role: null,
            dues: null,
            page: 1,
            membership: null,
          })}
        >
          Clear filters
        </TextLink>
      ) : null}
    </form>
  );
}

// Carries the parts of the roster query a form does not edit itself.
function RosterQueryFields({
  query,
  keep,
}: Readonly<{
  query: MemberRosterQuery;
  keep: readonly ("filters" | "sort" | "pageSize")[];
}>) {
  return (
    <>
      {keep.includes("filters") ? (
        <>
          {query.search ? (
            <input type="hidden" name="search" value={query.search} />
          ) : null}
          {query.alphabet ? (
            <input type="hidden" name="alphabet" value={query.alphabet} />
          ) : null}
          {query.status ? (
            <input type="hidden" name="status" value={query.status} />
          ) : null}
          {query.role ? (
            <input type="hidden" name="role" value={query.role} />
          ) : null}
          {query.dues ? (
            <input type="hidden" name="dues" value={query.dues} />
          ) : null}
        </>
      ) : null}
      {keep.includes("sort") && query.sort !== "name" ? (
        <input type="hidden" name="sort" value={query.sort} />
      ) : null}
      {keep.includes("sort") && query.direction !== "asc" ? (
        <input type="hidden" name="direction" value={query.direction} />
      ) : null}
      {keep.includes("pageSize") && query.pageSize !== 25 ? (
        <input type="hidden" name="pageSize" value={query.pageSize} />
      ) : null}
    </>
  );
}

const rosterNoticeClass =
  "mt-6 grid gap-2 rounded-lg border border-dashed border-input bg-muted/50 p-4 text-muted-foreground [&_h2]:m-0 [&_h2]:font-sans [&_h2]:text-base [&_h2]:text-foreground [&_p]:m-0 [&_p]:leading-[1.5]";

function MemberRosterContent({
  activeCount,
  members,
  query,
  selectedMemberId,
  totalCount,
}: Readonly<{
  activeCount: number;
  members: readonly ManageableMemberRosterRow[];
  query: MemberRosterQuery;
  selectedMemberId: string | null;
  totalCount: number;
}>) {
  const totalPages = memberRosterTotalPages(totalCount, query);
  const pageOutOfRange = totalCount > 0 && query.page > totalPages;
  const noActiveMembers = memberRosterHasNoActiveMembers(
    query,
    activeCount,
    totalCount,
  );

  if (pageOutOfRange) {
    return (
      <div className={rosterNoticeClass} role="status">
        <h2>No members on this page</h2>
        <p>
          These members fill {totalPages} page{totalPages === 1 ? "" : "s"}. Go
          back to the first page.
        </p>
        <TextLink
          href={buildMemberRosterHref(query, { page: 1, membership: null })}
        >
          Go to first page
        </TextLink>
      </div>
    );
  }

  if (members.length === 0) {
    const filtered = memberRosterQueryHasFilters(query);
    return (
      <div className={rosterNoticeClass} role="status">
        <h2>
          {filtered ? "No members match these filters" : "No members yet"}
        </h2>
        <p>
          {filtered
            ? "Try a different search, or clear the filters."
            : "Add a member or import a list to start your roster."}
        </p>
      </div>
    );
  }

  return (
    <>
      {noActiveMembers ? (
        <div className={rosterNoticeClass} role="status">
          <h2>No active members</h2>
        </div>
      ) : null}
      <div className="mt-6 max-[960px]:hidden">
        <table className="w-full table-fixed border-collapse text-left text-[0.875rem] [&_:is(th,td)]:border-b [&_:is(th,td)]:px-3 [&_:is(th,td)]:py-3.5 [&_:is(th,td)]:align-top [&_:is(th,td):first-child]:w-[30%] [&_:is(th,td):first-child]:pl-0 [&_:is(th,td):last-child]:pr-0 [&_tbody_tr]:transition-colors [&_tbody_tr:hover]:bg-muted/50 [&_thead_a]:text-inherit [&_thead_a]:no-underline [&_thead_a:hover]:text-foreground [&_thead_th]:border-t [&_thead_th]:py-2.5 [&_thead_th]:font-mono [&_thead_th]:text-[0.6875rem] [&_thead_th]:font-medium [&_thead_th]:tracking-[0.08em] [&_thead_th]:whitespace-nowrap [&_thead_th]:text-muted-foreground [&_thead_th]:uppercase [&_thead_th[aria-sort=ascending]]:text-foreground [&_thead_th[aria-sort=descending]]:text-foreground">
          <caption className="sr-only">Group member roster</caption>
          <thead>
            <tr>
              <MemberSortHeader label="Member" query={query} sortKey="name" />
              <MemberSortHeader label="Status" query={query} sortKey="status" />
              <MemberSortHeader label="Role" query={query} sortKey="role" />
              <MemberSortHeader label="Dues" query={query} sortKey="dues" />
              <MemberSortHeader
                label="Handicap"
                query={query}
                sortKey="handicap"
              />
              <MemberSortHeader label="Quota" query={query} sortKey="quota" />
            </tr>
          </thead>
          <tbody>
            {members.map((member) => (
              <MemberRosterTableRow
                key={member.membershipId}
                member={member}
                query={query}
                selected={selectedMemberId === member.membershipId}
              />
            ))}
          </tbody>
        </table>
      </div>
      <ul
        className="m-0 mt-6 hidden list-none border-t p-0 max-[960px]:grid"
        data-slot="member-roster-cards"
        aria-label="Group member roster cards"
      >
        {members.map((member) => (
          <li key={member.membershipId}>
            <MemberRosterCard
              member={member}
              query={query}
              selected={selectedMemberId === member.membershipId}
            />
          </li>
        ))}
      </ul>
      <MemberRosterFooter
        query={query}
        shownCount={members.length}
        totalCount={totalCount}
        totalPages={totalPages}
      />
    </>
  );
}

function MemberSortHeader({
  label,
  query,
  sortKey,
}: Readonly<{
  label: string;
  query: MemberRosterQuery;
  sortKey: MemberRosterSortKey;
}>) {
  const active = query.sort === sortKey;
  const nextDirection = sortDirectionFor(query, sortKey);
  return (
    <th
      scope="col"
      aria-sort={
        active
          ? query.direction === "asc"
            ? "ascending"
            : "descending"
          : "none"
      }
    >
      <Link
        href={buildMemberRosterHref(query, {
          sort: sortKey,
          direction: nextDirection,
          page: 1,
          membership: null,
        })}
        aria-label={`${label}; sort ${nextDirection === "asc" ? "ascending" : "descending"}`}
      >
        {label}
        {active ? (
          <span aria-hidden="true">
            {" "}
            {query.direction === "asc" ? "↑" : "↓"}
          </span>
        ) : null}
      </Link>
    </th>
  );
}

// An empty cell: a quiet dash, so the values that are set stand out.
function NotSet() {
  return (
    <>
      <span aria-hidden="true" className="text-muted-foreground/60">
        —
      </span>
      <span className="sr-only">Not set</span>
    </>
  );
}

// A figure with an optional note under it, for handicap and quota.
function RosterFigure({
  value,
  note,
}: Readonly<{ value: string | null; note: string | null }>) {
  return (
    <>
      {value === null ? (
        note ? null : (
          <NotSet />
        )
      ) : (
        <span className="font-mono font-medium tabular-nums">{value}</span>
      )}
      {note ? (
        <span className="block text-xs leading-[1.45] text-muted-foreground">
          {note}
        </span>
      ) : null}
    </>
  );
}

function RosterStatus({
  member,
}: Readonly<{ member: ManageableMemberRosterRow }>) {
  return (
    <span
      className={
        member.status === "active" ? undefined : "text-muted-foreground"
      }
    >
      {formatStatus(member.status)}
    </span>
  );
}

function RosterDues({
  member,
}: Readonly<{ member: ManageableMemberRosterRow }>) {
  return member.duesPaid ? (
    "Paid"
  ) : (
    <span className="text-muted-foreground">Not set yet</span>
  );
}

function MemberRosterTableRow({
  member,
  query,
  selected,
}: Readonly<{
  member: ManageableMemberRosterRow;
  query: MemberRosterQuery;
  selected: boolean;
}>) {
  const href = buildMemberRosterHref(query, {
    membership: member.membershipId,
  });
  const invitation = formatRosterInvitation(member);
  return (
    <tr>
      <th scope="row" className="font-normal">
        <Link
          className="font-semibold text-foreground no-underline underline-offset-[0.2em] hover:text-primary hover:underline"
          href={href}
          aria-current={selected ? "page" : undefined}
        >
          {formatMemberName(member)}
        </Link>
        {invitation ? (
          <span
            className={`block text-xs leading-[1.45] ${member.invitationDeliveryActionRequired ? "text-destructive" : "text-muted-foreground"}`}
          >
            {invitation}
          </span>
        ) : null}
      </th>
      <td>
        <RosterStatus member={member} />
      </td>
      <td>{formatRole(member.role)}</td>
      <td>
        <RosterDues member={member} />
      </td>
      <td>
        <RosterFigure {...rosterHandicap(member)} />
      </td>
      <td>
        <RosterFigure {...rosterQuota(member)} />
      </td>
    </tr>
  );
}

function MemberRosterCard({
  member,
  query,
  selected,
}: Readonly<{
  member: ManageableMemberRosterRow;
  query: MemberRosterQuery;
  selected: boolean;
}>) {
  const invitation = formatRosterInvitation(member);
  return (
    <article className="grid gap-3 border-b py-4 [&_dd]:m-0 [&_dd]:mt-1 [&_dd]:text-[0.875rem] [&_dl]:m-0 [&_dl]:grid [&_dl]:grid-cols-2 [&_dl]:gap-x-4 [&_dl]:gap-y-3 [&_dt]:font-mono [&_dt]:text-[0.6875rem] [&_dt]:font-medium [&_dt]:tracking-[0.08em] [&_dt]:text-muted-foreground [&_dt]:uppercase">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="m-0 font-sans text-base font-semibold">
          <Link
            className="text-foreground no-underline underline-offset-[0.2em] hover:text-primary hover:underline"
            href={buildMemberRosterHref(query, {
              membership: member.membershipId,
            })}
            aria-current={selected ? "page" : undefined}
          >
            {formatMemberName(member)}
          </Link>
        </h2>
        <span className="text-[0.8125rem]">
          <RosterStatus member={member} />
        </span>
      </div>
      {invitation ? (
        <p
          className={`m-0 text-xs ${member.invitationDeliveryActionRequired ? "text-destructive" : "text-muted-foreground"}`}
        >
          {invitation}
        </p>
      ) : null}
      <dl>
        <div>
          <dt>Role</dt>
          <dd>{formatRole(member.role)}</dd>
        </div>
        <div>
          <dt>Dues</dt>
          <dd>
            <RosterDues member={member} />
          </dd>
        </div>
        <div>
          <dt>Handicap</dt>
          <dd>
            <RosterFigure {...rosterHandicap(member)} />
          </dd>
        </div>
        <div>
          <dt>Quota</dt>
          <dd>
            <RosterFigure {...rosterQuota(member)} />
          </dd>
        </div>
      </dl>
    </article>
  );
}

function MemberRosterFooter({
  query,
  shownCount,
  totalCount,
  totalPages,
}: Readonly<{
  query: MemberRosterQuery;
  shownCount: number;
  totalCount: number;
  totalPages: number;
}>) {
  const first = (query.page - 1) * query.pageSize + 1;
  const noun = `${memberRosterQueryHasFilters(query) ? "matching " : ""}member${totalCount === 1 ? "" : "s"}`;
  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-x-6 gap-y-3 text-[0.8125rem] text-muted-foreground">
      <p className="m-0" aria-live="polite">
        {totalPages > 1
          ? `Showing ${first}–${first + shownCount - 1} of ${totalCount} ${noun}`
          : `${totalCount} ${noun}`}
      </p>
      {totalCount > 25 ? (
        <div className="flex flex-wrap items-center gap-3">
          <form
            className="flex items-center gap-2"
            action="/portal/members"
            method="get"
          >
            <label
              className="font-normal text-muted-foreground"
              htmlFor="member-roster-page-size"
            >
              Members per page
            </label>
            <NativeSelect
              className="w-20"
              id="member-roster-page-size"
              name="pageSize"
              defaultValue={String(query.pageSize)}
              onChange={(event) => event.currentTarget.form?.requestSubmit()}
            >
              <option value="25">25</option>
              <option value="50">50</option>
              <option value="100">100</option>
            </NativeSelect>
            <RosterQueryFields query={query} keep={["filters", "sort"]} />
          </form>
          {totalPages > 1 ? (
            <nav className="flex gap-2" aria-label="Member roster pages">
              {query.page > 1 ? (
                <Button asChild variant="outline">
                  <Link
                    href={buildMemberRosterHref(query, {
                      page: query.page - 1,
                      membership: null,
                    })}
                  >
                    Previous
                  </Link>
                </Button>
              ) : null}
              {query.page < totalPages ? (
                <Button asChild variant="outline">
                  <Link
                    href={buildMemberRosterHref(query, {
                      page: query.page + 1,
                      membership: null,
                    })}
                  >
                    Next
                  </Link>
                </Button>
              ) : null}
            </nav>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function rosterHandicap(member: ManageableMemberRosterRow) {
  if (member.handicapValue === null) return { value: null, note: null };
  const note = [
    member.handicapSource
      ? member.handicapSource === "manual"
        ? "Manual"
        : "Import"
      : null,
    member.handicapAsOf,
  ]
    .filter((part): part is string => Boolean(part))
    .join(" · ");
  return { value: member.handicapValue, note: note || null };
}

function rosterQuota(member: ManageableMemberRosterRow) {
  if (member.currentQuota === null) {
    return {
      value: null,
      note: member.usesInitialQuota ? "Starting quota pending" : null,
    };
  }
  const note = [
    formatMemberRosterQuotaProvenance(member.currentQuotaProvenance),
    member.currentQuotaEffectiveAt
      ? `effective ${formatDate(member.currentQuotaEffectiveAt)}`
      : null,
  ]
    .filter((part): part is string => Boolean(part))
    .join(" · ");
  return { value: member.currentQuota, note: note || null };
}

// Shown under the name only while an invitation is still open or has failed.
function formatRosterInvitation(member: ManageableMemberRosterRow) {
  const state = member.invitationState
    ? formatInvitationState(member.invitationState)
    : null;
  if (member.invitationDeliveryActionRequired) {
    return `${state ?? "Invitation"} · Needs attention`;
  }
  return member.status === "pending" && state ? `Invitation: ${state}` : null;
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date unavailable";
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(date);
}

function MemberEditor({
  actorMembershipId,
  member,
  onTerminalMessage,
  privateContact,
  role,
  tab,
}: Readonly<{
  actorMembershipId: string;
  member: ManageableMember;
  tab: MemberEditorTab;
  onTerminalMessage: (status: "success" | "error", message: string) => void;
  privateContact: MemberPrivateContact;
  role: "member" | "coordinator" | "administrator";
}>) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [values, setValues] = useState<EditorValues>(() =>
    initialValues(member, privateContact),
  );
  const [editReason, setEditReason] = useState("");
  const [statusReason, setStatusReason] = useState("");
  const [statusConfirmed, setStatusConfirmed] = useState(false);
  const [selectedRole, setSelectedRole] = useState(member.role);
  const [roleReason, setRoleReason] = useState("");
  const [roleConfirmed, setRoleConfirmed] = useState(false);
  const [handicapId, setHandicapId] = useState("");
  const [handicap, setHandicap] = useState("");
  const [handicapAsOf, setHandicapAsOf] = useState("");
  const [handicapReason, setHandicapReason] = useState("");
  const [handicapConfirmed, setHandicapConfirmed] = useState(false);
  const [handicapStale, setHandicapStale] = useState(false);
  const [profileBaselineFingerprint, setProfileBaselineFingerprint] = useState(
    memberProfileFingerprint(initialValues(member, privateContact), ""),
  );
  const [statusBaselineFingerprint, setStatusBaselineFingerprint] = useState(
    memberStatusFingerprint("", false),
  );
  const [roleBaselineFingerprint, setRoleBaselineFingerprint] = useState(
    memberRoleFingerprint(member.role, "", false),
  );
  const [handicapBaselineFingerprint, setHandicapBaselineFingerprint] =
    useState(memberHandicapFingerprint("", "", "", "", false));
  const operationId = useRef<string | null>(null);
  const operationFingerprint = useRef<string | null>(null);
  const handicapRecoveryKey = `greenroster:member-handicap:${member.membershipId}`;

  useEffect(() => {
    try {
      const stored = window.sessionStorage.getItem(handicapRecoveryKey);
      if (!stored) return;
      const value: unknown = JSON.parse(stored);
      if (!isHandicapDraft(value)) return;
      window.sessionStorage.removeItem(handicapRecoveryKey);
      window.setTimeout(() => {
        setHandicapId(value.handicapId);
        setHandicap(value.handicap);
        setHandicapAsOf(value.asOf);
        setHandicapReason(value.reason);
        setHandicapConfirmed(value.confirmed);
      }, 0);
    } catch {
      // Storage restrictions or an invalid draft must not block member access.
    }
  }, [handicapRecoveryKey]);

  const profileDirty =
    memberProfileFingerprint(values, editReason) !== profileBaselineFingerprint;
  const statusDirty =
    memberStatusFingerprint(statusReason, statusConfirmed) !==
    statusBaselineFingerprint;
  const roleDirty =
    memberRoleFingerprint(selectedRole, roleReason, roleConfirmed) !==
    roleBaselineFingerprint;
  const handicapDirty =
    memberHandicapFingerprint(
      handicapId,
      handicap,
      handicapAsOf,
      handicapReason,
      handicapConfirmed,
    ) !== handicapBaselineFingerprint;
  const dirty = profileDirty || statusDirty || roleDirty || handicapDirty;

  useEffect(() => {
    function warnBeforeUnload(event: BeforeUnloadEvent) {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = "";
    }

    function confirmLinkNavigation(event: MouseEvent) {
      if (!dirty || event.defaultPrevented || event.button !== 0) return;
      const target = event.target;
      const link =
        target instanceof Element
          ? target.closest<HTMLAnchorElement>("a[href]")
          : null;
      if (!link) return;
      if (
        !shouldAllowDirtyNavigation(dirty, () =>
          window.confirm("Discard unsaved member changes?"),
        )
      ) {
        event.preventDefault();
        event.stopPropagation();
      }
    }

    function confirmOtherFormSubmission(event: SubmitEvent) {
      const form = event.target;
      if (
        !dirty ||
        !(form instanceof HTMLFormElement) ||
        form.dataset.form === "member-edit-form" ||
        form.dataset.form === "member-status-form" ||
        form.dataset.form === "member-role-form" ||
        form.dataset.form === "member-handicap-form"
      ) {
        return;
      }
      if (
        !shouldAllowDirtyNavigation(dirty, () =>
          window.confirm("Discard unsaved member changes?"),
        )
      ) {
        event.preventDefault();
        event.stopPropagation();
      }
    }

    window.addEventListener("beforeunload", warnBeforeUnload);
    document.addEventListener("click", confirmLinkNavigation, true);
    document.addEventListener("submit", confirmOtherFormSubmission, true);
    return () => {
      window.removeEventListener("beforeunload", warnBeforeUnload);
      document.removeEventListener("click", confirmLinkNavigation, true);
      document.removeEventListener("submit", confirmOtherFormSubmission, true);
    };
  }, [dirty]);

  const permissions = memberTargetPermissions(actorMembershipId, role, member);
  const restrictedTarget = !permissions.canEdit;
  const canEdit = permissions.canEdit;
  const canChangeStatus = permissions.canChangeStatus;
  const canChangeRole = canChangeMemberRole(role, member);
  const nextStatus = member.status === "active" ? "inactive" : "active";

  function update<K extends keyof EditorValues>(
    key: K,
    value: EditorValues[K],
  ) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  function beginOperation(
    kind: "edit" | "status" | "role" | "handicap",
    payload: unknown,
  ) {
    const state = retainMemberOperationId(
      {
        fingerprint: operationFingerprint.current,
        operationId: operationId.current,
      },
      kind,
      payload,
      () => crypto.randomUUID(),
    );
    operationFingerprint.current = state.fingerprint;
    operationId.current = state.operationId;
    return state.operationId;
  }

  function submitEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canEdit) return;
    if (
      !shouldAllowMemberFormSubmit(
        "profile",
        {
          profile: profileDirty,
          status: statusDirty,
          role: roleDirty,
          handicap: handicapDirty,
        },
        () =>
          window.confirm(
            "Discard your other unsaved changes before saving member details?",
          ),
      )
    ) {
      return;
    }
    if (statusDirty) {
      setStatusReason("");
      setStatusConfirmed(false);
      setStatusBaselineFingerprint(memberStatusFingerprint("", false));
    }
    if (roleDirty) {
      setSelectedRole(member.role);
      setRoleReason("");
      setRoleConfirmed(false);
      setRoleBaselineFingerprint(memberRoleFingerprint(member.role, "", false));
    }
    if (handicapDirty) resetHandicapForm();
    onTerminalMessage("error", "");
    const editPayload = {
      ...values,
      membershipId: member.membershipId,
      expectedProfileVersion: member.profileVersion,
      expectedContactVersion: privateContact.contactVersion,
      expectedMembershipVersion: member.membershipVersion,
      reason: editReason.trim() || null,
    };
    const input: MemberEditInput = {
      ...editPayload,
      operationId: beginOperation("edit", editPayload),
    };

    startTransition(async () => {
      try {
        const result = await editMemberAction(input);
        if (result.ok) {
          operationId.current = null;
          operationFingerprint.current = null;
          setEditReason("");
          setProfileBaselineFingerprint(memberProfileFingerprint(values, ""));
          onTerminalMessage("success", "Member details saved.");
          router.refresh();
          return;
        }
        onTerminalMessage("error", result.error.message);
      } catch {
        onTerminalMessage("error", "We couldn't save your changes. Try again.");
      }
    });
  }

  function submitStatus(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canChangeStatus) return;
    if (
      !shouldAllowMemberFormSubmit(
        "status",
        {
          profile: profileDirty,
          status: statusDirty,
          role: roleDirty,
          handicap: handicapDirty,
        },
        () =>
          window.confirm(
            "Discard your other unsaved changes before changing status?",
          ),
      )
    ) {
      return;
    }
    if (profileDirty) {
      const restoredValues = initialValues(member, privateContact);
      setValues(restoredValues);
      setEditReason("");
      setProfileBaselineFingerprint(
        memberProfileFingerprint(restoredValues, ""),
      );
    }
    if (roleDirty) {
      setSelectedRole(member.role);
      setRoleReason("");
      setRoleConfirmed(false);
      setRoleBaselineFingerprint(memberRoleFingerprint(member.role, "", false));
    }
    if (handicapDirty) resetHandicapForm();
    onTerminalMessage("error", "");
    const input = {
      membershipId: member.membershipId,
      newStatus: nextStatus,
      expectedMembershipVersion: member.membershipVersion,
      confirmed: statusConfirmed,
      reason: statusReason,
      operationId: beginOperation("status", {
        newStatus: nextStatus,
        expectedMembershipVersion: member.membershipVersion,
        confirmed: statusConfirmed,
        reason: statusReason.trim(),
      }),
    };

    startTransition(async () => {
      try {
        const result = await setMemberStatusAction(input);
        if (result.ok) {
          operationId.current = null;
          operationFingerprint.current = null;
          setStatusReason("");
          setStatusConfirmed(false);
          setStatusBaselineFingerprint(memberStatusFingerprint("", false));
          onTerminalMessage(
            "success",
            result.data.status === "inactive"
              ? "Member marked inactive. Their pending notifications were cancelled."
              : "Member reactivated.",
          );
          router.refresh();
          return;
        }
        onTerminalMessage("error", result.error.message);
      } catch {
        onTerminalMessage("error", "We couldn't save your changes. Try again.");
      }
    });
  }

  function submitRole(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canChangeRole || selectedRole === member.role) return;
    const normalizedRoleReason = roleReason.trim();
    if (!roleConfirmed || normalizedRoleReason.length === 0) {
      onTerminalMessage("error", "Add a reason and confirm the role change.");
      return;
    }
    if (
      !shouldAllowMemberFormSubmit(
        "role",
        {
          profile: profileDirty,
          status: statusDirty,
          role: roleDirty,
          handicap: handicapDirty,
        },
        () =>
          window.confirm(
            "Discard your unsaved changes before changing this role?",
          ),
      )
    ) {
      return;
    }
    if (profileDirty) {
      const restoredValues = initialValues(member, privateContact);
      setValues(restoredValues);
      setEditReason("");
      setProfileBaselineFingerprint(
        memberProfileFingerprint(restoredValues, ""),
      );
    }
    if (statusDirty) {
      setStatusReason("");
      setStatusConfirmed(false);
      setStatusBaselineFingerprint(memberStatusFingerprint("", false));
    }
    if (handicapDirty) resetHandicapForm();
    onTerminalMessage("error", "");
    const payload = {
      membershipId: member.membershipId,
      newRole: selectedRole,
      expectedMembershipVersion: member.membershipVersion,
      confirmed: true as const,
      reason: normalizedRoleReason,
    };
    const input: MemberRoleInput = {
      ...payload,
      operationId: beginOperation("role", payload),
    };

    startTransition(async () => {
      try {
        const result = await changeMemberRoleAction(input);
        if (result.ok) {
          operationId.current = null;
          operationFingerprint.current = null;
          setRoleReason("");
          setRoleConfirmed(false);
          setRoleBaselineFingerprint(
            memberRoleFingerprint(result.data.newRole, "", false),
          );
          onTerminalMessage(
            "success",
            result.data.roleChanged
              ? `Member role changed to ${formatRole(result.data.newRole)}.`
              : "This member already has that role.",
          );
          router.refresh();
          return;
        }
        onTerminalMessage("error", result.error.message);
      } catch {
        onTerminalMessage("error", "We couldn't save your changes. Try again.");
      }
    });
  }

  function resetHandicapForm() {
    setHandicapId("");
    setHandicap("");
    setHandicapAsOf("");
    setHandicapReason("");
    setHandicapConfirmed(false);
    setHandicapStale(false);
    setHandicapBaselineFingerprint(
      memberHandicapFingerprint("", "", "", "", false),
    );
  }

  function submitHandicap(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canEdit) return;
    if (
      !handicap ||
      !handicapAsOf ||
      !handicapReason.trim() ||
      !handicapConfirmed
    ) {
      onTerminalMessage(
        "error",
        "Enter a handicap and date, add a reason, and confirm the correction.",
      );
      return;
    }
    if (
      !shouldAllowMemberFormSubmit(
        "handicap",
        {
          profile: profileDirty,
          status: statusDirty,
          role: roleDirty,
          handicap: handicapDirty,
        },
        () =>
          window.confirm(
            "Discard your other unsaved changes before saving this handicap?",
          ),
      )
    ) {
      return;
    }
    if (profileDirty) {
      const restoredValues = initialValues(member, privateContact);
      setValues(restoredValues);
      setEditReason("");
      setProfileBaselineFingerprint(
        memberProfileFingerprint(restoredValues, ""),
      );
    }
    if (statusDirty) {
      setStatusReason("");
      setStatusConfirmed(false);
      setStatusBaselineFingerprint(memberStatusFingerprint("", false));
    }
    if (roleDirty) {
      setSelectedRole(member.role);
      setRoleReason("");
      setRoleConfirmed(false);
      setRoleBaselineFingerprint(memberRoleFingerprint(member.role, "", false));
    }
    onTerminalMessage("error", "");
    const payload = {
      membershipId: member.membershipId,
      handicapId: handicapId.trim() || null,
      handicap,
      asOf: handicapAsOf,
      expectedMembershipVersion: member.membershipVersion,
      confirmed: true as const,
      reason: handicapReason.trim(),
    };
    const input: MemberHandicapInput = {
      ...payload,
      operationId: beginOperation("handicap", payload),
    };

    startTransition(async () => {
      try {
        const result = await setMemberHandicapAction(input);
        if (result.ok) {
          operationId.current = null;
          operationFingerprint.current = null;
          resetHandicapForm();
          onTerminalMessage(
            "success",
            `Handicap ${result.data.handicap} saved, dated ${result.data.asOf}.`,
          );
          router.refresh();
          return;
        }
        setHandicapStale(result.error.code === "stale_version");
        onTerminalMessage("error", result.error.message);
      } catch {
        onTerminalMessage("error", "We couldn't save your changes. Try again.");
      }
    });
  }

  function reloadStaleHandicap() {
    try {
      window.sessionStorage.setItem(
        handicapRecoveryKey,
        JSON.stringify({
          handicapId,
          handicap,
          asOf: handicapAsOf,
          reason: handicapReason,
          confirmed: handicapConfirmed,
        }),
      );
    } catch {
      // Reload still gives the actor a current version if storage is blocked.
    }
    window.location.reload();
  }

  return (
    <div className="grid max-w-184 gap-8" data-slot="member-editor">
      {tab === "details" ? (
        <form
          className="gap-5 grid [&_fieldset]:m-0 [&_fieldset]:p-0 [&_fieldset]:gap-5 [&_fieldset]:border-0 [&_fieldset]:grid [&_fieldset]:min-w-0 [&_legend]:mb-1 [&_legend]:text-[1.125rem] [&_legend]:font-semibold"
          data-form="member-edit-form"
          onSubmit={submitEdit}
          noValidate
        >
          <fieldset disabled={pending || !canEdit}>
            <legend>Profile</legend>
            <div className="gap-4 grid grid-cols-2 max-[720px]:grid-cols-[1fr]">
              <Field
                label="First name"
                value={values.firstName}
                onChange={(value) => update("firstName", value)}
                required
              />
              <Field
                label="Last name"
                value={values.lastName}
                onChange={(value) => update("lastName", value)}
                required
              />
              <Field
                label="Spouse first name"
                value={values.spouseFirstName ?? ""}
                onChange={(value) => update("spouseFirstName", value || null)}
              />
              <Field
                label="Spouse last name"
                value={values.spouseLastName ?? ""}
                onChange={(value) => update("spouseLastName", value || null)}
              />
              <label
                className="gap-2 grid [&>label]:text-[0.8125rem] [&>label]:font-bold [&>label]:tracking-[0.015em] [&>span]:text-[0.8125rem] [&>span]:font-bold [&>span]:tracking-[0.015em]"
                data-slot="field"
              >
                <span>Tee location</span>
                <NativeSelect
                  value={values.teeLocation ?? ""}
                  onChange={(event) =>
                    update(
                      "teeLocation",
                      (event.target.value ||
                        null) as EditorValues["teeLocation"],
                    )
                  }
                >
                  <option value="">Not set</option>
                  <option value="pro">Pro</option>
                  <option value="back">Back</option>
                  <option value="middle">Middle</option>
                  <option value="front">Front</option>
                </NativeSelect>
              </label>
              <label className="gap-2 flex items-center min-h-11 text-muted-foreground text-[0.8125rem]">
                <Checkbox
                  checked={values.duesPaid}
                  onCheckedChange={(checked) =>
                    update("duesPaid", checked === true)
                  }
                />
                <span>Dues paid</span>
              </label>
            </div>

            <fieldset
              className="m-0 mt-3! grid gap-4 [&_legend]:mb-1 [&_legend]:text-[1.125rem] [&_legend]:font-semibold"
              data-slot="member-contact-fieldset"
            >
              <legend>Contact details</legend>
              <FieldHelp>
                Only coordinators and administrators see these, unless you list
                them in the member directory below.
              </FieldHelp>
              <div className="gap-4 grid grid-cols-2 max-[720px]:grid-cols-[1fr]">
                <Field
                  label="Secondary e-mail"
                  type="email"
                  value={values.secondaryEmail ?? ""}
                  onChange={(value) => update("secondaryEmail", value || null)}
                />
                <Field
                  label="Home phone"
                  value={values.homePhone ?? ""}
                  onChange={(value) => update("homePhone", value || null)}
                />
                <Field
                  label="Work phone"
                  value={values.workPhone ?? ""}
                  onChange={(value) => update("workPhone", value || null)}
                />
                <Field
                  label="Mobile phone"
                  value={values.mobilePhone ?? ""}
                  onChange={(value) => update("mobilePhone", value || null)}
                />
                <Field
                  label="Address line 1"
                  value={values.addressLine1 ?? ""}
                  onChange={(value) => update("addressLine1", value || null)}
                />
                <Field
                  label="Address line 2"
                  value={values.addressLine2 ?? ""}
                  onChange={(value) => update("addressLine2", value || null)}
                />
                <Field
                  label="City"
                  value={values.city ?? ""}
                  onChange={(value) => update("city", value || null)}
                />
                <Field
                  label="State / region"
                  value={values.stateRegion ?? ""}
                  onChange={(value) => update("stateRegion", value || null)}
                />
                <Field
                  label="Postal code"
                  value={values.postalCode ?? ""}
                  onChange={(value) => update("postalCode", value || null)}
                />
                <Field
                  label="Country"
                  value={values.country ?? ""}
                  onChange={(value) => update("country", value || null)}
                />
              </div>
              <p className="m-0 mt-2 text-[0.8125rem] font-bold">
                Show in the member directory
              </p>
              <div className="flex flex-wrap gap-y-3 gap-x-4">
                <Visibility
                  label="Secondary e-mail"
                  checked={values.secondaryEmailVisible}
                  onChange={(value) => update("secondaryEmailVisible", value)}
                />
                <Visibility
                  label="Home phone"
                  checked={values.homePhoneVisible}
                  onChange={(value) => update("homePhoneVisible", value)}
                />
                <Visibility
                  label="Work phone"
                  checked={values.workPhoneVisible}
                  onChange={(value) => update("workPhoneVisible", value)}
                />
                <Visibility
                  label="Mobile phone"
                  checked={values.mobilePhoneVisible}
                  onChange={(value) => update("mobilePhoneVisible", value)}
                />
                <Visibility
                  label="Postal address"
                  checked={values.addressListed}
                  onChange={(value) => update("addressListed", value)}
                />
              </div>
            </fieldset>

            <label
              className="gap-2 grid [&>label]:text-[0.8125rem] [&>label]:font-bold [&>label]:tracking-[0.015em] [&>span]:text-[0.8125rem] [&>span]:font-bold [&>span]:tracking-[0.015em]"
              data-slot="field"
            >
              <span>Reason for the change (optional)</span>
              <Textarea
                value={editReason}
                onChange={(event) => setEditReason(event.target.value)}
                maxLength={500}
                rows={2}
              />
            </label>
            <Button type="submit">
              {pending ? "Saving…" : "Save member details"}
            </Button>
          </fieldset>
        </form>
      ) : null}

      {tab === "handicap" ? (
        <form
          className="gap-5 grid [&_fieldset]:m-0 [&_fieldset]:p-0 [&_fieldset]:gap-5 [&_fieldset]:border-0 [&_fieldset]:grid [&_fieldset]:min-w-0 [&_legend]:mb-1 [&_legend]:text-[1.125rem] [&_legend]:font-semibold"
          data-form="member-handicap-form"
          onSubmit={submitHandicap}
          noValidate
        >
          <fieldset disabled={pending || !canEdit}>
            <legend>Enter a handicap</legend>
            <FieldHelp>
              Earlier handicaps stay in this member&apos;s history.
            </FieldHelp>
            <div className="gap-4 grid grid-cols-2 max-[720px]:grid-cols-[1fr]">
              <Field
                label="Handicap ID"
                value={handicapId}
                onChange={setHandicapId}
              />
              <label
                className="gap-2 grid [&>label]:text-[0.8125rem] [&>label]:font-bold [&>label]:tracking-[0.015em] [&>span]:text-[0.8125rem] [&>span]:font-bold [&>span]:tracking-[0.015em]"
                data-slot="field"
              >
                <span>Handicap</span>
                <Input
                  type="number"
                  min="-10"
                  max="54"
                  step="0.1"
                  value={handicap}
                  onChange={(event) => setHandicap(event.target.value)}
                  required
                />
              </label>
              <label
                className="gap-2 grid [&>label]:text-[0.8125rem] [&>label]:font-bold [&>label]:tracking-[0.015em] [&>span]:text-[0.8125rem] [&>span]:font-bold [&>span]:tracking-[0.015em]"
                data-slot="field"
              >
                <span>Handicap date</span>
                <Input
                  type="date"
                  value={handicapAsOf}
                  onChange={(event) => setHandicapAsOf(event.target.value)}
                  required
                />
              </label>
            </div>
            <label
              className="gap-2 grid [&>label]:text-[0.8125rem] [&>label]:font-bold [&>label]:tracking-[0.015em] [&>span]:text-[0.8125rem] [&>span]:font-bold [&>span]:tracking-[0.015em]"
              data-slot="field"
            >
              <span>Reason (required)</span>
              <Textarea
                value={handicapReason}
                onChange={(event) => setHandicapReason(event.target.value)}
                maxLength={500}
                rows={2}
                required
              />
            </label>
            <label
              className="gap-2 flex items-start text-muted-foreground text-[0.75rem] leading-[1.45]"
              htmlFor={`member-handicap-confirm-${member.membershipId}`}
            >
              <Checkbox
                id={`member-handicap-confirm-${member.membershipId}`}
                checked={handicapConfirmed}
                onCheckedChange={(checked) =>
                  setHandicapConfirmed(checked === true)
                }
                required
              />
              <span>I confirm this correction.</span>
            </label>
            <Button
              type="submit"
              disabled={
                !handicap ||
                !handicapAsOf ||
                !handicapReason.trim() ||
                !handicapConfirmed
              }
            >
              {pending ? "Recording…" : "Save handicap"}
            </Button>
            {handicapStale ? (
              <Button
                variant="link"
                size="inline"
                type="button"
                onClick={reloadStaleHandicap}
              >
                Reload and keep what I typed
              </Button>
            ) : null}
          </fieldset>
        </form>
      ) : null}

      {tab !== "access" ? null : member.status === "pending" ? (
        <FieldHelp>
          This member must accept their invitation before you can change their
          status.
        </FieldHelp>
      ) : (
        <form
          className="gap-5 grid [&_[data-slot=field-help]]:text-muted-foreground [&_fieldset]:m-0 [&_fieldset]:p-0 [&_fieldset]:gap-5 [&_fieldset]:border-0 [&_fieldset]:grid [&_fieldset]:min-w-0 [&_legend]:mb-1 [&_legend]:text-[1.125rem] [&_legend]:font-semibold"
          data-form="member-status-form"
          onSubmit={submitStatus}
          noValidate
        >
          <fieldset disabled={pending || !canChangeStatus}>
            <legend>Member status</legend>
            {restrictedTarget ? (
              <FieldHelp>
                Only administrators can change another administrator.
              </FieldHelp>
            ) : null}
            {member.membershipId === actorMembershipId ? (
              <FieldHelp>You can&apos;t change your own status.</FieldHelp>
            ) : null}
            {canChangeStatus ? (
              <>
                <label
                  className="gap-2 grid [&>label]:text-[0.8125rem] [&>label]:font-bold [&>label]:tracking-[0.015em] [&>span]:text-[0.8125rem] [&>span]:font-bold [&>span]:tracking-[0.015em]"
                  data-slot="field"
                >
                  <span>Reason (required)</span>
                  <Textarea
                    value={statusReason}
                    onChange={(event) => setStatusReason(event.target.value)}
                    maxLength={500}
                    rows={2}
                    required
                  />
                </label>
                <label
                  className="gap-2 flex items-start text-muted-foreground text-[0.75rem] leading-[1.45]"
                  htmlFor={`member-status-confirm-${member.membershipId}`}
                >
                  <Checkbox
                    id={`member-status-confirm-${member.membershipId}`}
                    checked={statusConfirmed}
                    onCheckedChange={(checked) =>
                      setStatusConfirmed(checked === true)
                    }
                    required
                  />
                  <span>
                    I understand this changes whether the member can RSVP and
                    get notifications.
                  </span>
                </label>
                <Button
                  variant={
                    nextStatus === "inactive" ? "destructive" : "outline"
                  }
                  type="submit"
                >
                  {pending
                    ? "Working…"
                    : nextStatus === "inactive"
                      ? "Mark inactive"
                      : "Reactivate member"}
                </Button>
              </>
            ) : null}
          </fieldset>
        </form>
      )}

      {tab !== "access" ? null : canChangeRole ? (
        <form
          className="gap-5 grid border-t pt-8 [&_fieldset]:m-0 [&_fieldset]:p-0 [&_fieldset]:gap-5 [&_fieldset]:border-0 [&_fieldset]:grid [&_fieldset]:min-w-0 [&_legend]:mb-1 [&_legend]:text-[1.125rem] [&_legend]:font-semibold"
          data-form="member-role-form"
          onSubmit={submitRole}
          noValidate
        >
          <fieldset disabled={pending}>
            <legend>Role</legend>
            <label
              className="gap-2 grid [&>label]:text-[0.8125rem] [&>label]:font-bold [&>label]:tracking-[0.015em] [&>span]:text-[0.8125rem] [&>span]:font-bold [&>span]:tracking-[0.015em]"
              data-slot="field"
            >
              <span>Change role to</span>
              <NativeSelect
                value={selectedRole}
                onChange={(event) =>
                  setSelectedRole(event.target.value as typeof selectedRole)
                }
              >
                <option value="member">Member</option>
                <option value="coordinator">Coordinator</option>
                <option value="administrator">Administrator</option>
              </NativeSelect>
            </label>
            <label
              className="gap-2 grid [&>label]:text-[0.8125rem] [&>label]:font-bold [&>label]:tracking-[0.015em] [&>span]:text-[0.8125rem] [&>span]:font-bold [&>span]:tracking-[0.015em]"
              data-slot="field"
            >
              <span>Reason (required)</span>
              <Textarea
                value={roleReason}
                onChange={(event) => setRoleReason(event.target.value)}
                maxLength={500}
                rows={2}
                required
              />
            </label>
            <label
              className="gap-2 flex items-start text-muted-foreground text-[0.75rem] leading-[1.45]"
              htmlFor={`member-role-confirm-${member.membershipId}`}
            >
              <Checkbox
                id={`member-role-confirm-${member.membershipId}`}
                checked={roleConfirmed}
                onCheckedChange={(checked) =>
                  setRoleConfirmed(checked === true)
                }
                required
              />
              <span>
                I understand this changes what they can do right away.
              </span>
            </label>
            <Button
              type="submit"
              disabled={
                selectedRole === member.role ||
                roleReason.trim().length === 0 ||
                !roleConfirmed
              }
            >
              {pending ? "Working…" : "Save role change"}
            </Button>
            {selectedRole === member.role ||
            roleReason.trim().length === 0 ||
            !roleConfirmed ? (
              <FieldHelp role="status">
                Choose a different role, add a reason, and confirm the change
                before saving.
              </FieldHelp>
            ) : null}
          </fieldset>
        </form>
      ) : (
        <FieldHelp>
          Only administrators can change a member&apos;s role.
        </FieldHelp>
      )}

      {dirty ? (
        <FieldHelp role="status">You have unsaved changes.</FieldHelp>
      ) : null}
    </div>
  );
}

function isHandicapDraft(value: unknown): value is Readonly<{
  handicapId: string;
  handicap: string;
  asOf: string;
  reason: string;
  confirmed: boolean;
}> {
  if (!value || typeof value !== "object") return false;
  const draft = value as Record<string, unknown>;
  return (
    typeof draft.handicapId === "string" &&
    typeof draft.handicap === "string" &&
    typeof draft.asOf === "string" &&
    typeof draft.reason === "string" &&
    typeof draft.confirmed === "boolean"
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  required = false,
}: Readonly<{
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: "text" | "email";
  required?: boolean;
}>) {
  return (
    <label
      className="gap-2 grid [&>label]:text-[0.8125rem] [&>label]:font-bold [&>label]:tracking-[0.015em] [&>span]:text-[0.8125rem] [&>span]:font-bold [&>span]:tracking-[0.015em]"
      data-slot="field"
    >
      <span>{label}</span>
      <Input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required={required}
      />
    </label>
  );
}

function Visibility({
  label,
  checked,
  onChange,
}: Readonly<{
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}>) {
  return (
    <label className="gap-2 flex items-center min-h-11 text-muted-foreground text-[0.8125rem]">
      <Checkbox
        checked={checked}
        onCheckedChange={(checked) => onChange(checked === true)}
      />
      <span>{label}</span>
    </label>
  );
}

function initialValues(
  member: ManageableMember,
  contact: MemberPrivateContact,
): EditorValues {
  return {
    firstName: member.firstName,
    lastName: member.lastName,
    spouseFirstName: member.spouseFirstName,
    spouseLastName: member.spouseLastName,
    teeLocation: member.teeLocation,
    duesPaid: member.duesPaid,
    secondaryEmail: contact.secondaryEmail,
    homePhone: contact.homePhone,
    workPhone: contact.workPhone,
    mobilePhone: contact.mobilePhone,
    addressLine1: contact.addressLine1,
    addressLine2: contact.addressLine2,
    city: contact.city,
    stateRegion: contact.stateRegion,
    postalCode: contact.postalCode,
    country: contact.country,
    secondaryEmailVisible: contact.secondaryEmailVisible,
    homePhoneVisible: contact.homePhoneVisible,
    workPhoneVisible: contact.workPhoneVisible,
    mobilePhoneVisible: contact.mobilePhoneVisible,
    addressListed: contact.addressListed,
    reason: null,
  };
}

function formatStatus(status: ManageableMember["status"]) {
  return status[0].toUpperCase() + status.slice(1);
}

function formatInvitationState(
  status: NonNullable<ManageableMemberRosterRow["invitationState"]>,
) {
  return status[0].toUpperCase() + status.slice(1);
}

function formatMemberName(
  member: Pick<ManageableMember, "firstName" | "lastName">,
) {
  return `${member.firstName} ${member.lastName}`.trim() || "Name needed";
}

function formatRole(role: ManageableMember["role"]) {
  return role[0].toUpperCase() + role.slice(1);
}
