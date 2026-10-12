"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import type { FormEvent } from "react";

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
import { FieldHelp, FormMessage, Kicker, TextLink } from "@/components/blocks";
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
import {
  formatMemberRosterInitialQuotaUsage,
  formatMemberRosterQuotaProvenance,
} from "@/domain/member-roster-presentation";
import type {
  ManageableMember,
  ManageableMemberRosterRow,
  MemberEditInput,
  MemberHandicapInput,
  MemberPrivateContact,
  MemberRoleInput,
} from "@/lib/memberships/member-management";

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
  members,
  privateContact,
  role,
  rosterQuery,
  selectedMember,
  totalCount,
}: Readonly<{
  actorMembershipId: string;
  activeCount: number;
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
    <div className="mt-10 gap-6 grid grid-cols-[minmax(15rem,0.8fr)_minmax(0,1.7fr)] max-[720px]:grid-cols-[1fr] [&>[data-slot='alert']]:col-span-full [&>[data-slot=member-editor]]:col-span-full">
      {selectedMember ? null : (
        <div
          className="border bg-muted self-start col-span-full [&_[data-slot=member-roster-cards]]:m-0 [&_[data-slot=member-roster-cards]]:p-0 [&_[data-slot=member-roster-cards]]:hidden [&_[data-slot=member-roster-cards]]:list-none max-[960px]:[&_[data-slot=member-roster-cards]]:grid!"
          aria-label="Group members"
        >
          <div className="p-5 gap-4 border-b border-b-border/50 flex items-start justify-between [&_h2]:m-0 [&_h2]:text-[1.5rem] [&_h2]:font-semibold [&_span]:text-muted-foreground [&_span]:text-[0.75rem]!">
            <h2>Roster</h2>
            <span>
              {totalCount} {totalCount === 1 ? "member" : "members"}
            </span>
          </div>
          <MemberRosterFilters query={rosterQuery} />
          <MemberAlphabetFilter query={rosterQuery} />
          <MemberRosterContent
            activeCount={activeCount}
            members={members}
            query={rosterQuery}
            selectedMemberId={null}
            totalCount={totalCount}
          />
        </div>
      )}

      {selectedMember ? (
        <MemberEditor
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
  return (
    <form
      className="p-5 gap-4 border-b border-b-border/50 grid"
      action="/portal/members"
      method="get"
    >
      <div className="gap-3 grid grid-cols-6 max-[960px]:grid-cols-2 max-[720px]:grid-cols-[1fr]">
        <label
          className="gap-2 grid col-span-3 max-[960px]:col-span-full max-[720px]:col-[auto] [&>label]:text-[0.8125rem] [&>label]:font-bold [&>label]:tracking-[0.015em] [&>span]:text-[0.8125rem] [&>span]:font-bold [&>span]:tracking-[0.015em]"
          data-slot="field"
        >
          <span>Search by name, invite e-mail, or Handicap ID</span>
          <Input
            name="search"
            type="search"
            defaultValue={query.search}
            maxLength={200}
            autoComplete="off"
          />
        </label>
        <label
          className="gap-2 grid [&>label]:text-[0.8125rem] [&>label]:font-bold [&>label]:tracking-[0.015em] [&>span]:text-[0.8125rem] [&>span]:font-bold [&>span]:tracking-[0.015em]"
          data-slot="field"
        >
          <span>Status</span>
          <NativeSelect name="status" defaultValue={query.status ?? ""}>
            <option value="">All statuses</option>
            <option value="pending">Pending</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </NativeSelect>
        </label>
        {query.alphabet ? (
          <input type="hidden" name="alphabet" value={query.alphabet} />
        ) : null}
        <label
          className="gap-2 grid [&>label]:text-[0.8125rem] [&>label]:font-bold [&>label]:tracking-[0.015em] [&>span]:text-[0.8125rem] [&>span]:font-bold [&>span]:tracking-[0.015em]"
          data-slot="field"
        >
          <span>Role</span>
          <NativeSelect name="role" defaultValue={query.role ?? ""}>
            <option value="">All roles</option>
            <option value="member">Member</option>
            <option value="coordinator">Coordinator</option>
            <option value="administrator">Administrator</option>
          </NativeSelect>
        </label>
        <label
          className="gap-2 grid [&>label]:text-[0.8125rem] [&>label]:font-bold [&>label]:tracking-[0.015em] [&>span]:text-[0.8125rem] [&>span]:font-bold [&>span]:tracking-[0.015em]"
          data-slot="field"
        >
          <span>Dues</span>
          <NativeSelect name="dues" defaultValue={query.dues ?? ""}>
            <option value="">All dues</option>
            <option value="paid">Paid</option>
            <option value="unpaid">Not set yet</option>
          </NativeSelect>
        </label>
        <label
          className="gap-2 grid [&>label]:text-[0.8125rem] [&>label]:font-bold [&>label]:tracking-[0.015em] [&>span]:text-[0.8125rem] [&>span]:font-bold [&>span]:tracking-[0.015em]"
          data-slot="field"
        >
          <span>Per page</span>
          <NativeSelect name="pageSize" defaultValue={String(query.pageSize)}>
            <option value="25">25</option>
            <option value="50">50</option>
            <option value="100">100</option>
          </NativeSelect>
        </label>
        <label
          className="gap-2 grid [&>label]:text-[0.8125rem] [&>label]:font-bold [&>label]:tracking-[0.015em] [&>span]:text-[0.8125rem] [&>span]:font-bold [&>span]:tracking-[0.015em]"
          data-slot="field"
        >
          <span>Sort by</span>
          <NativeSelect name="sort" defaultValue={query.sort}>
            <option value="name">Name</option>
            <option value="status">Status</option>
            <option value="role">Role</option>
            <option value="dues">Dues</option>
            <option value="tee">Tee</option>
            <option value="handicap">Handicap</option>
            <option value="quota">Quota</option>
            <option value="date_added">Date added</option>
            <option value="invitation">Invitation</option>
          </NativeSelect>
        </label>
        <label
          className="gap-2 grid [&>label]:text-[0.8125rem] [&>label]:font-bold [&>label]:tracking-[0.015em] [&>span]:text-[0.8125rem] [&>span]:font-bold [&>span]:tracking-[0.015em]"
          data-slot="field"
        >
          <span>Order</span>
          <NativeSelect name="direction" defaultValue={query.direction}>
            <option value="asc">Ascending</option>
            <option value="desc">Descending</option>
          </NativeSelect>
        </label>
      </div>
      <div className="gap-3 flex items-center flex-wrap">
        <Button variant="outline" type="submit">
          Apply filters
        </Button>
        {memberRosterQueryHasFilters(query) ||
        query.page !== 1 ||
        query.pageSize !== 25 ? (
          <TextLink href="/portal/members">Clear filters</TextLink>
        ) : null}
      </div>
    </form>
  );
}

function MemberAlphabetFilter({
  query,
}: Readonly<{ query: MemberRosterQuery }>) {
  return (
    <nav
      className="py-[0.85rem] px-5 gap-[0.35rem] border-b border-b-border/50 flex items-center flex-wrap text-muted-foreground text-[0.75rem] [&>span]:mr-[0.35rem] [&>span]:font-bold [&_a:hover]:bg-card [&_a[aria-current='page']]:rounded-lg [&_a[aria-current='page']]:text-card [&_a[aria-current='page']]:font-bold [&_a[aria-current='page']]:border-primary! [&_a[aria-current='page']]:bg-primary! [&_a]:px-[0.35rem] [&_a]:border [&_a]:border-transparent [&_a]:inline-grid [&_a]:min-w-[1.65rem] [&_a]:min-h-[1.65rem] [&_a]:place-items-center [&_a]:rounded-lg [&_a]:text-primary [&_a]:no-underline"
      aria-label="Filter members by surname initial"
    >
      <span>Alphabet</span>
      <Link
        href={buildMemberRosterHref(query, {
          alphabet: null,
          page: 1,
          membership: null,
        })}
        aria-current={query.alphabet === null ? "page" : undefined}
      >
        All
      </Link>
      {Array.from({ length: 26 }, (_, index) => {
        const letter = String.fromCharCode(65 + index);
        return (
          <Link
            key={letter}
            href={buildMemberRosterHref(query, {
              alphabet: letter,
              page: 1,
              membership: null,
            })}
            aria-current={query.alphabet === letter ? "page" : undefined}
          >
            {letter}
          </Link>
        );
      })}
    </nav>
  );
}

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
      <div
        className="py-6 px-5 gap-3 grid text-muted-foreground [&_h3]:m-0 [&_h3]:text-foreground [&_h3]:font-semibold [&_h3]:text-[1.25rem]! [&_p]:m-0 [&_p]:leading-[1.5]"
        role="status"
      >
        <h3>No members on this page</h3>
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
      <div
        className="py-6 px-5 gap-3 grid text-muted-foreground [&_h3]:m-0 [&_h3]:text-foreground [&_h3]:font-semibold [&_h3]:text-[1.25rem]! [&_p]:m-0 [&_p]:leading-[1.5]"
        role="status"
      >
        <h3>
          {filtered ? "No members match these filters" : "No members yet"}
        </h3>
        <p>
          {filtered
            ? "Try a different search, or clear the filters."
            : "Add a member or import a list to start your roster."}
        </p>
        {filtered ? (
          <TextLink href="/portal/members">Clear filters</TextLink>
        ) : null}
      </div>
    );
  }

  return (
    <>
      {noActiveMembers ? (
        <div
          className="py-6 px-5 gap-3 grid text-muted-foreground [&_h3]:m-0 [&_h3]:text-foreground [&_h3]:font-semibold [&_h3]:text-[1.25rem]! [&_p]:m-0 [&_p]:leading-[1.5]"
          role="status"
        >
          <h3>No active members</h3>
        </div>
      ) : null}
      <p
        className="m-0 py-[0.85rem] px-5 border-b border-b-border/50 text-muted-foreground text-[0.75rem]"
        aria-live="polite"
      >
        Showing {members.length} of {totalCount} matching member
        {totalCount === 1 ? "" : "s"}. Page {query.page} of {totalPages}.
      </p>
      <div className="overflow-hidden w-full max-[960px]:hidden">
        <table className="w-full border-collapse table-fixed text-[0.8125rem] [&_:is(th,td):first-child]:pl-5 [&_:is(th,td):first-child]:w-[20%] [&_:is(th,td):last-child]:pr-5 [&_tbody_th]:font-semibold [&_tbody_th]:text-[0.875rem]! [&_tbody_th_a:hover]:text-primary [&_tbody_th_a:hover]:underline [&_tbody_th_a:hover]:underline-offset-[0.2em] [&_tbody_th_a[aria-current='page']]:text-primary [&_tbody_th_a[aria-current='page']]:underline [&_tbody_th_a[aria-current='page']]:underline-offset-[0.2em] [&_tbody_th_a]:text-inherit [&_tbody_th_a]:no-underline [&_tbody_tr:last-child_:is(th,td)]:border-b-0 [&_td]:py-3 [&_td]:px-[0.6rem] [&_td]:border-b [&_td]:border-b-border/50 [&_td]:text-left [&_td]:align-top [&_td]:wrap-anywhere [&_th]:py-3 [&_th]:px-[0.6rem] [&_th]:border-b [&_th]:border-b-border/50 [&_th]:text-left [&_th]:align-top [&_th]:wrap-anywhere [&_thead_a:focus-visible]:text-primary [&_thead_a:focus-visible]:underline [&_thead_a:hover]:text-primary [&_thead_a:hover]:underline [&_thead_a]:text-inherit [&_thead_a]:no-underline [&_thead_a]:underline-offset-[0.2em] [&_thead_th]:text-muted-foreground [&_thead_th]:text-[0.6875rem] [&_thead_th]:tracking-[0.04em] [&_thead_th]:[overflow-wrap:normal] [&_thead_th]:uppercase [&_thead_th]:whitespace-nowrap">
          <caption className="sr-only">Group member roster</caption>
          <thead>
            <tr>
              <MemberSortHeader label="Member" query={query} sortKey="name" />
              <MemberSortHeader label="Status" query={query} sortKey="status" />
              <MemberSortHeader label="Role" query={query} sortKey="role" />
              <MemberSortHeader label="Dues" query={query} sortKey="dues" />
              <MemberSortHeader label="Tee" query={query} sortKey="tee" />
              <MemberSortHeader
                label="Handicap"
                query={query}
                sortKey="handicap"
              />
              <MemberSortHeader label="Quota" query={query} sortKey="quota" />
              <MemberSortHeader
                label="Added"
                query={query}
                sortKey="date_added"
              />
              <MemberSortHeader
                label="Invitation"
                query={query}
                sortKey="invitation"
              />
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
      <MemberRosterPagination query={query} totalPages={totalPages} />
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
  return (
    <tr>
      <th scope="row">
        <Link href={href} aria-current={selected ? "page" : undefined}>
          {formatMemberName(member)}
        </Link>
      </th>
      <td>{formatStatus(member.status)}</td>
      <td>{formatRole(member.role)}</td>
      <td>{member.duesPaid ? "Paid" : "Not set yet"}</td>
      <td>{member.teeLocation ? formatTee(member.teeLocation) : "Not set"}</td>
      <td>{formatRosterHandicap(member)}</td>
      <td>{formatRosterQuota(member)}</td>
      <td>{formatDate(member.dateAdded)}</td>
      <td>{formatInvitation(member)}</td>
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
  return (
    <article
      className="p-5 gap-4 border-b border-b-border/50 grid [&[data-selected='true']]:[box-shadow:inset_0.2rem_0_var(--primary)] [&[data-selected='true']]:bg-card [&_dd]:mx-0 [&_dd]:mt-1 [&_dd]:mb-0 [&_dd]:text-muted-foreground [&_dd]:text-[0.8125rem] [&_dd]:wrap-anywhere [&_dl]:m-0 [&_dl]:grid [&_dl]:grid-cols-2 [&_dl]:gap-y-[0.85rem] [&_dl]:gap-x-4 max-[720px]:[&_dl]:grid-cols-[1fr]! [&_dt]:text-muted-foreground [&_dt]:text-[0.6875rem] [&_dt]:tracking-[0.06em] [&_dt]:uppercase"
      data-selected={selected || undefined}
    >
      <div className="gap-4 flex items-start justify-between [&>span]:text-muted-foreground [&>span]:font-bold [&>span]:uppercase [&>span]:text-[0.6875rem]! [&>span]:tracking-[0.06em]! [&_a:hover]:underline [&_a:hover]:underline-offset-[0.2em] [&_a:hover]:text-primary! [&_a[aria-current='page']]:underline [&_a[aria-current='page']]:underline-offset-[0.2em] [&_a[aria-current='page']]:text-primary! [&_a]:no-underline [&_h3]:m-0 [&_h3]:text-[1.125rem] [&_h3]:font-semibold">
        <h3>
          <Link
            href={buildMemberRosterHref(query, {
              membership: member.membershipId,
            })}
            aria-current={selected ? "page" : undefined}
          >
            {formatMemberName(member)}
          </Link>
        </h3>
        <span>{formatStatus(member.status)}</span>
      </div>
      <dl>
        <div>
          <dt>Role</dt>
          <dd>{formatRole(member.role)}</dd>
        </div>
        <div>
          <dt>Dues</dt>
          <dd>{member.duesPaid ? "Paid" : "Not set yet"}</dd>
        </div>
        <div>
          <dt>Tee</dt>
          <dd>
            {member.teeLocation ? formatTee(member.teeLocation) : "Not set"}
          </dd>
        </div>
        <div>
          <dt>Handicap</dt>
          <dd>{formatRosterHandicap(member)}</dd>
        </div>
        <div>
          <dt>Quota</dt>
          <dd>{formatRosterQuota(member)}</dd>
        </div>
        <div>
          <dt>Added</dt>
          <dd>{formatDate(member.dateAdded)}</dd>
        </div>
        <div>
          <dt>Invitation</dt>
          <dd>{formatInvitation(member)}</dd>
        </div>
      </dl>
    </article>
  );
}

function MemberRosterPagination({
  query,
  totalPages,
}: Readonly<{ query: MemberRosterQuery; totalPages: number }>) {
  if (totalPages <= 1) return null;
  return (
    <nav
      className="py-4 px-5 gap-4 flex items-center justify-between text-muted-foreground text-[0.75rem] [&>div]:gap-3 [&>div]:flex [&_a]:text-primary [&_a]:font-bold [&_a]:underline-offset-[0.2em]"
      aria-label="Member roster pages"
    >
      <span>
        Page {query.page} of {totalPages}
      </span>
      <div>
        {query.page > 1 ? (
          <Link
            href={buildMemberRosterHref(query, {
              page: query.page - 1,
              membership: null,
            })}
          >
            Previous
          </Link>
        ) : null}
        {query.page < totalPages ? (
          <Link
            href={buildMemberRosterHref(query, {
              page: query.page + 1,
              membership: null,
            })}
          >
            Next
          </Link>
        ) : null}
      </div>
    </nav>
  );
}

function formatRosterHandicap(member: ManageableMemberRosterRow) {
  if (member.handicapValue === null) return "Not set yet";
  const source = member.handicapSource
    ? ` · ${member.handicapSource === "manual" ? "Manual" : "Import"}`
    : "";
  const asOf = member.handicapAsOf ? ` · ${member.handicapAsOf}` : "";
  return `${member.handicapValue}${source}${asOf}`;
}

function formatRosterQuota(member: ManageableMemberRosterRow) {
  const initialQuotaUsage = formatMemberRosterInitialQuotaUsage(
    member.usesInitialQuota,
  );
  if (member.currentQuota === null) {
    return [
      member.usesInitialQuota ? "Starting quota pending" : "Not set yet",
      initialQuotaUsage,
    ].join(" · ");
  }
  const provenance = formatMemberRosterQuotaProvenance(
    member.currentQuotaProvenance,
  );
  const effective = member.currentQuotaEffectiveAt
    ? `effective ${formatDate(member.currentQuotaEffectiveAt)}`
    : null;
  return [member.currentQuota, provenance, effective, initialQuotaUsage]
    .filter((value): value is string => Boolean(value))
    .join(" · ");
}

function formatInvitation(member: ManageableMemberRosterRow) {
  if (member.invitationDeliveryActionRequired) {
    return `${member.invitationState ? formatInvitationState(member.invitationState) : "Invitation"} · Needs attention`;
  }
  return member.invitationState
    ? formatInvitationState(member.invitationState)
    : "None";
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
}: Readonly<{
  actorMembershipId: string;
  member: ManageableMember;
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
    <div className="pb-6 gap-6 border bg-muted grid" data-slot="member-editor">
      <div className="p-5 gap-4 border-b border-b-border/50 flex items-start justify-between [&_h2]:mx-0 [&_h2]:mb-0 [&_h2]:text-[1.5rem] [&_h2]:font-semibold [&_h2]:mt-[0.35rem]!">
        <div>
          <Kicker>Member</Kicker>
          <h2>{formatMemberName(member)}</h2>
        </div>
        <span
          className="text-[0.6875rem] font-bold tracking-[0.08em] uppercase text-muted-foreground data-[status=active]:text-primary"
          data-status={member.status}
        >
          {formatStatus(member.status)}
        </span>
      </div>

      <dl className="my-0 mx-5 pb-5 gap-4 border-b border-b-border/50 grid grid-cols-3 max-[720px]:grid-cols-[1fr] [&_dd]:mx-0 [&_dd]:mb-0 [&_dd]:text-muted-foreground [&_dd]:text-[0.8125rem] [&_dd]:wrap-anywhere [&_dd]:mt-[0.35rem]! [&_dt]:text-muted-foreground [&_dt]:text-[0.6875rem] [&_dt]:uppercase [&_dt]:tracking-[0.08em]!">
        <div>
          <dt>Role</dt>
          <dd>{formatRole(member.role)}</dd>
        </div>
        <div>
          <dt>Dues</dt>
          <dd>{member.duesPaid ? "Paid" : "Not set yet"}</dd>
        </div>
      </dl>

      <form
        className="my-0 mx-5 gap-5 grid [&_fieldset]:m-0 [&_fieldset]:p-0 [&_fieldset]:gap-5 [&_fieldset]:border-0 [&_fieldset]:grid [&_fieldset]:min-w-0 [&_legend]:mb-1 [&_legend]:text-[1.125rem] [&_legend]:font-semibold"
        data-form="member-edit-form"
        onSubmit={submitEdit}
        noValidate
      >
        <fieldset disabled={pending || !canEdit}>
          <legend>Profile and contact details</legend>
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
                    (event.target.value || null) as EditorValues["teeLocation"],
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
            className="m-0 p-4 gap-4 grid border! border-border/50! [&_legend]:mb-1 [&_legend]:text-[1.125rem] [&_legend]:font-semibold"
            data-slot="member-contact-fieldset"
          >
            <legend>Private contact details</legend>
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
            <div className="flex flex-wrap gap-y-3 gap-x-4">
              <Visibility
                label="List secondary e-mail"
                checked={values.secondaryEmailVisible}
                onChange={(value) => update("secondaryEmailVisible", value)}
              />
              <Visibility
                label="List home phone"
                checked={values.homePhoneVisible}
                onChange={(value) => update("homePhoneVisible", value)}
              />
              <Visibility
                label="List work phone"
                checked={values.workPhoneVisible}
                onChange={(value) => update("workPhoneVisible", value)}
              />
              <Visibility
                label="List mobile phone"
                checked={values.mobilePhoneVisible}
                onChange={(value) => update("mobilePhoneVisible", value)}
              />
              <Visibility
                label="List address"
                checked={values.addressListed}
                onChange={(value) => update("addressListed", value)}
              />
            </div>
          </fieldset>

          <label
            className="gap-2 grid [&>label]:text-[0.8125rem] [&>label]:font-bold [&>label]:tracking-[0.015em] [&>span]:text-[0.8125rem] [&>span]:font-bold [&>span]:tracking-[0.015em]"
            data-slot="field"
          >
            <span>Reason (optional)</span>
            <Textarea
              value={editReason}
              onChange={(event) => setEditReason(event.target.value)}
              maxLength={500}
              rows={3}
            />
          </label>
          <Button type="submit">
            {pending ? "Saving…" : "Save member details"}
          </Button>
        </fieldset>
      </form>

      <form
        className="my-0 mx-5 pt-5 gap-5 border-t border-t-border/50 grid [&_fieldset]:m-0 [&_fieldset]:p-0 [&_fieldset]:gap-5 [&_fieldset]:border-0 [&_fieldset]:grid [&_fieldset]:min-w-0"
        data-form="member-handicap-form"
        onSubmit={submitHandicap}
        noValidate
      >
        <fieldset disabled={pending || !canEdit}>
          <legend>Enter a handicap</legend>
          <FieldHelp>Earlier handicaps stay in the history below.</FieldHelp>
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
              rows={3}
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
            variant="outline"
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

      {member.status === "pending" ? (
        <FieldHelp>
          This member must accept their invitation before you can change their
          status.
        </FieldHelp>
      ) : (
        <form
          className="my-0 mx-5 pt-5 gap-5 border-t border-t-border/50 grid [&_[data-slot=field-help]]:text-muted-foreground [&_fieldset]:m-0 [&_fieldset]:p-0 [&_fieldset]:gap-5 [&_fieldset]:border-0 [&_fieldset]:grid [&_fieldset]:min-w-0 [&_legend]:mb-1 [&_legend]:text-[1.125rem] [&_legend]:font-semibold"
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
            <label
              className="gap-2 grid [&>label]:text-[0.8125rem] [&>label]:font-bold [&>label]:tracking-[0.015em] [&>span]:text-[0.8125rem] [&>span]:font-bold [&>span]:tracking-[0.015em]"
              data-slot="field"
            >
              <span>Reason (required)</span>
              <Textarea
                value={statusReason}
                onChange={(event) => setStatusReason(event.target.value)}
                maxLength={500}
                rows={3}
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
                I understand this changes whether the member can RSVP and get
                notifications.
              </span>
            </label>
            <Button
              variant={nextStatus === "inactive" ? "destructive" : "outline"}
              type="submit"
            >
              {pending
                ? "Working…"
                : nextStatus === "inactive"
                  ? "Mark inactive"
                  : "Reactivate member"}
            </Button>
          </fieldset>
        </form>
      )}

      {canChangeRole ? (
        <form
          className="my-0 mx-5 pt-5 gap-5 border-t border-t-border/50 grid [&_fieldset]:m-0 [&_fieldset]:p-0 [&_fieldset]:gap-5 [&_fieldset]:border-0 [&_fieldset]:grid [&_fieldset]:min-w-0"
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
              <span>Role</span>
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
                rows={3}
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
              variant="outline"
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
      ) : null}

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

function formatTee(tee: NonNullable<ManageableMemberRosterRow["teeLocation"]>) {
  return tee[0].toUpperCase() + tee.slice(1);
}
