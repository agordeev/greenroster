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
    <div className="member-management">
      <div className="member-list" aria-label="Group members">
        <div className="member-list-heading">
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
          selectedMemberId={selectedMember?.membershipId ?? null}
          totalCount={totalCount}
        />
      </div>

      {selectedMember ? (
        <MemberEditor
          key={`${selectedMember.membershipId}:${selectedMember.membershipVersion}:${selectedMember.profileVersion}:${privateContact?.contactVersion ?? 0}`}
          actorMembershipId={actorMembershipId}
          member={selectedMember}
          privateContact={privateContact ?? emptyContact}
          role={role}
          onTerminalMessage={showTerminalMessage}
        />
      ) : (
        <div className="member-editor-empty">
          <h2>Select a member</h2>
          <p>Choose a member to see and edit their details.</p>
        </div>
      )}
      <div
        className="form-message"
        aria-live="polite"
        data-status={terminalMessage ? terminal.status : undefined}
      >
        {terminalMessage}
      </div>
    </div>
  );
}

function MemberRosterFilters({
  query,
}: Readonly<{ query: MemberRosterQuery }>) {
  return (
    <form
      className="member-roster-filters"
      action="/portal/members"
      method="get"
    >
      <div className="member-roster-filter-grid">
        <label className="field-group member-roster-search">
          <span>Search by name, invite e-mail, or Handicap ID</span>
          <input
            name="search"
            type="search"
            defaultValue={query.search}
            maxLength={200}
            autoComplete="off"
          />
        </label>
        <label className="field-group">
          <span>Status</span>
          <select name="status" defaultValue={query.status ?? ""}>
            <option value="">All statuses</option>
            <option value="pending">Pending</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </label>
        {query.alphabet ? (
          <input type="hidden" name="alphabet" value={query.alphabet} />
        ) : null}
        <label className="field-group">
          <span>Role</span>
          <select name="role" defaultValue={query.role ?? ""}>
            <option value="">All roles</option>
            <option value="member">Member</option>
            <option value="coordinator">Coordinator</option>
            <option value="administrator">Administrator</option>
          </select>
        </label>
        <label className="field-group">
          <span>Dues</span>
          <select name="dues" defaultValue={query.dues ?? ""}>
            <option value="">All dues</option>
            <option value="paid">Paid</option>
            <option value="unpaid">Not recorded</option>
          </select>
        </label>
        <label className="field-group">
          <span>Per page</span>
          <select name="pageSize" defaultValue={String(query.pageSize)}>
            <option value="25">25</option>
            <option value="50">50</option>
            <option value="100">100</option>
          </select>
        </label>
        <label className="field-group">
          <span>Sort by</span>
          <select name="sort" defaultValue={query.sort}>
            <option value="name">Name</option>
            <option value="status">Status</option>
            <option value="role">Role</option>
            <option value="dues">Dues</option>
            <option value="tee">Tee</option>
            <option value="handicap">Handicap</option>
            <option value="quota">Quota</option>
            <option value="date_added">Date added</option>
            <option value="invitation">Invitation</option>
          </select>
        </label>
        <label className="field-group">
          <span>Order</span>
          <select name="direction" defaultValue={query.direction}>
            <option value="asc">Ascending</option>
            <option value="desc">Descending</option>
          </select>
        </label>
      </div>
      <div className="member-roster-filter-actions">
        <button className="secondary-button" type="submit">
          Apply filters
        </button>
        {memberRosterQueryHasFilters(query) ||
        query.page !== 1 ||
        query.pageSize !== 25 ? (
          <Link className="secondary-link" href="/portal/members">
            Clear filters
          </Link>
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
      className="member-alphabet-filter"
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
      <div className="member-roster-empty" role="status">
        <h3>This page is past the end of the list</h3>
        <p>
          These members fill {totalPages} page{totalPages === 1 ? "" : "s"}.
          Open the first page to continue.
        </p>
        <Link
          className="secondary-link"
          href={buildMemberRosterHref(query, { page: 1, membership: null })}
        >
          Open first page
        </Link>
      </div>
    );
  }

  if (members.length === 0) {
    const filtered = memberRosterQueryHasFilters(query);
    return (
      <div className="member-roster-empty" role="status">
        <h3>
          {filtered ? "No members match these filters" : "No members yet"}
        </h3>
        <p>
          {filtered
            ? "Try a different search, or clear the filters."
            : "Add a member or import a list to start your roster."}
        </p>
        {filtered ? (
          <Link className="secondary-link" href="/portal/members">
            Clear filters
          </Link>
        ) : null}
      </div>
    );
  }

  return (
    <>
      {noActiveMembers ? (
        <div className="member-roster-empty" role="status">
          <h3>No active members</h3>
          <p>
            No one is active yet. Pending and inactive members are listed below
            for follow-up.
          </p>
        </div>
      ) : null}
      <p className="member-roster-result-summary" aria-live="polite">
        Showing {members.length} of {totalCount} matching member
        {totalCount === 1 ? "" : "s"}. Page {query.page} of {totalPages}.
      </p>
      <div className="member-roster-table-wrap">
        <table className="member-roster-table">
          <caption className="visually-hidden">Group member roster</caption>
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
        className="member-roster-cards"
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
      <td>{member.duesPaid ? "Paid" : "Not recorded"}</td>
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
      className="member-roster-card"
      data-selected={selected || undefined}
    >
      <div className="member-roster-card-heading">
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
          <dd>{member.duesPaid ? "Paid" : "Not recorded"}</dd>
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
    <nav className="member-roster-pagination" aria-label="Member roster pages">
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
  if (member.handicapValue === null) return "Not recorded";
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
      member.usesInitialQuota ? "Initial quota pending" : "Not recorded",
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
    return `${member.invitationState ? formatInvitationState(member.invitationState) : "Invitation"} · Action required`;
  }
  return member.invitationState
    ? formatInvitationState(member.invitationState)
    : "None";
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date unavailable";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(
    date,
  );
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
        form.classList.contains("member-edit-form") ||
        form.classList.contains("member-status-form") ||
        form.classList.contains("member-role-form") ||
        form.classList.contains("member-handicap-form")
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
      onTerminalMessage("error", "Add a reason and confirm the access change.");
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
            "Discard your other unsaved changes before recording this handicap?",
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
            `Manual handicap ${result.data.handicap} recorded as of ${result.data.asOf}.`,
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
    <div className="member-editor">
      <div className="member-editor-heading">
        <div>
          <p className="ledger-kicker">Member detail</p>
          <h2>{formatMemberName(member)}</h2>
        </div>
        <span className={`member-status member-status-${member.status}`}>
          {formatStatus(member.status)}
        </span>
      </div>

      <dl className="member-summary">
        <div>
          <dt>Role</dt>
          <dd>{formatRole(member.role)}</dd>
        </div>
        <div>
          <dt>Dues</dt>
          <dd>{member.duesPaid ? "Paid" : "Not recorded"}</dd>
        </div>
        <div>
          <dt>Update numbers</dt>
          <dd>
            profile {member.profileVersion} · contact{" "}
            {privateContact.contactVersion} · membership{" "}
            {member.membershipVersion}
          </dd>
        </div>
      </dl>

      <form className="member-edit-form" onSubmit={submitEdit} noValidate>
        <fieldset disabled={pending || !canEdit}>
          <legend>Profile and contact details</legend>
          <div className="member-form-grid">
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
            <label className="field-group">
              <span>Tee location</span>
              <select
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
              </select>
            </label>
            <label className="member-check">
              <input
                type="checkbox"
                checked={values.duesPaid}
                onChange={(event) => update("duesPaid", event.target.checked)}
              />
              <span>Dues paid</span>
            </label>
          </div>

          <fieldset className="member-contact-fieldset">
            <legend>Private contact details</legend>
            <div className="member-form-grid">
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
            <div className="member-visibility-grid">
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

          <label className="field-group">
            <span>Reason (optional)</span>
            <textarea
              value={editReason}
              onChange={(event) => setEditReason(event.target.value)}
              maxLength={500}
              rows={3}
            />
          </label>
          <button className="primary-button" type="submit">
            {pending ? "Saving…" : "Save member details"}
          </button>
        </fieldset>
      </form>

      <form
        className="member-handicap-form"
        onSubmit={submitHandicap}
        noValidate
      >
        <fieldset disabled={pending || !canEdit}>
          <legend>Record manual handicap</legend>
          <p className="field-help">
            Each correction is saved with its date. Earlier handicaps stay in
            the history below.
          </p>
          <div className="member-form-grid">
            <Field
              label="Handicap ID"
              value={handicapId}
              onChange={setHandicapId}
            />
            <label className="field-group">
              <span>Handicap</span>
              <input
                type="number"
                min="-10"
                max="54"
                step="0.1"
                value={handicap}
                onChange={(event) => setHandicap(event.target.value)}
                required
              />
            </label>
            <label className="field-group">
              <span>As-of date</span>
              <input
                type="date"
                value={handicapAsOf}
                onChange={(event) => setHandicapAsOf(event.target.value)}
                required
              />
            </label>
          </div>
          <label className="field-group">
            <span>Reason (required)</span>
            <textarea
              value={handicapReason}
              onChange={(event) => setHandicapReason(event.target.value)}
              maxLength={500}
              rows={3}
              required
            />
          </label>
          <label
            className="invitation-confirmation"
            htmlFor={`member-handicap-confirm-${member.membershipId}`}
          >
            <input
              id={`member-handicap-confirm-${member.membershipId}`}
              type="checkbox"
              checked={handicapConfirmed}
              onChange={(event) => setHandicapConfirmed(event.target.checked)}
              required
            />
            <span>
              I confirm this correction. It will stay in the member&apos;s
              handicap history.
            </span>
          </label>
          <button
            className="secondary-button"
            type="submit"
            disabled={
              !handicap ||
              !handicapAsOf ||
              !handicapReason.trim() ||
              !handicapConfirmed
            }
          >
            {pending ? "Recording…" : "Record handicap"}
          </button>
          {handicapStale ? (
            <button
              className="text-button"
              type="button"
              onClick={reloadStaleHandicap}
            >
              Reload and keep my entries
            </button>
          ) : null}
        </fieldset>
      </form>

      {member.status === "pending" ? (
        <p className="field-help">
          This member must accept their invitation before you can change their
          status.
        </p>
      ) : (
        <form className="member-status-form" onSubmit={submitStatus} noValidate>
          <fieldset disabled={pending || !canChangeStatus}>
            <legend>Member status</legend>
            {restrictedTarget ? (
              <p className="field-help">
                Coordinators cannot change administrators.
              </p>
            ) : null}
            {member.membershipId === actorMembershipId ? (
              <p className="field-help">
                You can&apos;t change your own status.
              </p>
            ) : null}
            <label className="field-group">
              <span>Reason (required)</span>
              <textarea
                value={statusReason}
                onChange={(event) => setStatusReason(event.target.value)}
                maxLength={500}
                rows={3}
                required
              />
            </label>
            <label
              className="invitation-confirmation"
              htmlFor={`member-status-confirm-${member.membershipId}`}
            >
              <input
                id={`member-status-confirm-${member.membershipId}`}
                type="checkbox"
                checked={statusConfirmed}
                onChange={(event) => setStatusConfirmed(event.target.checked)}
                required
              />
              <span>
                I understand this changes whether the member can RSVP and get
                notifications.
              </span>
            </label>
            <button
              className={
                nextStatus === "inactive" ? "danger-button" : "secondary-button"
              }
              type="submit"
            >
              {pending
                ? "Working…"
                : nextStatus === "inactive"
                  ? "Mark inactive"
                  : "Reactivate member"}
            </button>
          </fieldset>
        </form>
      )}

      {canChangeRole ? (
        <form className="member-role-form" onSubmit={submitRole} noValidate>
          <fieldset disabled={pending}>
            <legend>Role and access</legend>
            <label className="field-group">
              <span>Role</span>
              <select
                value={selectedRole}
                onChange={(event) =>
                  setSelectedRole(event.target.value as typeof selectedRole)
                }
              >
                <option value="member">Member</option>
                <option value="coordinator">Coordinator</option>
                <option value="administrator">Administrator</option>
              </select>
            </label>
            <label className="field-group">
              <span>Reason (required)</span>
              <textarea
                value={roleReason}
                onChange={(event) => setRoleReason(event.target.value)}
                maxLength={500}
                rows={3}
                required
              />
            </label>
            <label
              className="invitation-confirmation"
              htmlFor={`member-role-confirm-${member.membershipId}`}
            >
              <input
                id={`member-role-confirm-${member.membershipId}`}
                type="checkbox"
                checked={roleConfirmed}
                onChange={(event) => setRoleConfirmed(event.target.checked)}
                required
              />
              <span>I understand this changes their access right away.</span>
            </label>
            <button
              className="secondary-button"
              type="submit"
              disabled={
                selectedRole === member.role ||
                roleReason.trim().length === 0 ||
                !roleConfirmed
              }
            >
              {pending ? "Working…" : "Save role change"}
            </button>
            {selectedRole === member.role ||
            roleReason.trim().length === 0 ||
            !roleConfirmed ? (
              <p className="field-help" role="status">
                Choose a different role, add a reason, and confirm the change
                before saving.
              </p>
            ) : null}
          </fieldset>
        </form>
      ) : null}

      {dirty ? (
        <p className="field-help" role="status">
          You have unsaved changes. You&apos;ll be asked to confirm before
          leaving.
        </p>
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
    <label className="field-group">
      <span>{label}</span>
      <input
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
    <label className="member-check">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
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
