"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import type { FormEvent } from "react";

import {
  changeMemberRoleAction,
  editMemberAction,
  setMemberStatusAction,
} from "@/app/actions/memberships";
import {
  canChangeMemberRole,
  memberTargetPermissions,
  memberProfileFingerprint,
  memberRoleFingerprint,
  memberStatusFingerprint,
  retainMemberOperationId,
  shouldAllowMemberFormSubmit,
} from "@/lib/memberships/member-management";
import { shouldAllowDirtyNavigation } from "@/lib/groups/quota-settings-form-rules";
import type {
  ManageableMember,
  MemberEditInput,
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
  members,
  privateContact,
  role,
  selectedMember,
}: Readonly<{
  actorMembershipId: string;
  members: readonly ManageableMember[];
  privateContact: MemberPrivateContact | null;
  role: "member" | "coordinator" | "administrator";
  selectedMember: ManageableMember | null;
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
          <span>{members.length} records</span>
        </div>
        {members.length === 0 ? (
          <p className="member-empty">No member records are available.</p>
        ) : (
          <ul>
            {members.map((member) => (
              <li key={member.membershipId}>
                <Link
                  href={`/portal/members?membership=${member.membershipId}`}
                  aria-current={
                    selectedMember?.membershipId === member.membershipId
                      ? "page"
                      : undefined
                  }
                >
                  <span>{formatMemberName(member)}</span>
                  <small>
                    {formatStatus(member.status)} · {formatRole(member.role)}
                  </small>
                </Link>
              </li>
            ))}
          </ul>
        )}
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
          <p>
            Choose a roster record to load its audited private-contact detail
            and edit the member profile.
          </p>
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
  const [profileBaselineFingerprint, setProfileBaselineFingerprint] = useState(
    memberProfileFingerprint(initialValues(member, privateContact), ""),
  );
  const [statusBaselineFingerprint, setStatusBaselineFingerprint] = useState(
    memberStatusFingerprint("", false),
  );
  const [roleBaselineFingerprint, setRoleBaselineFingerprint] = useState(
    memberRoleFingerprint(member.role, "", false),
  );
  const operationId = useRef<string | null>(null);
  const operationFingerprint = useRef<string | null>(null);

  const profileDirty =
    memberProfileFingerprint(values, editReason) !== profileBaselineFingerprint;
  const statusDirty =
    memberStatusFingerprint(statusReason, statusConfirmed) !==
    statusBaselineFingerprint;
  const roleDirty =
    memberRoleFingerprint(selectedRole, roleReason, roleConfirmed) !==
    roleBaselineFingerprint;
  const dirty = profileDirty || statusDirty || roleDirty;

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
        form.classList.contains("member-role-form")
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

  function beginOperation(kind: "edit" | "status" | "role", payload: unknown) {
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
        { profile: profileDirty, status: statusDirty, role: roleDirty },
        () =>
          window.confirm(
            "Discard other unsaved member changes before saving member details?",
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
        onTerminalMessage(
          "error",
          "The member service is temporarily unavailable. Try again.",
        );
      }
    });
  }

  function submitStatus(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canChangeStatus) return;
    if (
      !shouldAllowMemberFormSubmit(
        "status",
        { profile: profileDirty, status: statusDirty, role: roleDirty },
        () =>
          window.confirm(
            "Discard other unsaved member changes before changing membership status?",
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
              ? "Member marked inactive; pending notifications were cancelled."
              : "Member reactivated.",
          );
          router.refresh();
          return;
        }
        onTerminalMessage("error", result.error.message);
      } catch {
        onTerminalMessage(
          "error",
          "The member service is temporarily unavailable. Try again.",
        );
      }
    });
  }

  function submitRole(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canChangeRole || selectedRole === member.role) return;
    const normalizedRoleReason = roleReason.trim();
    if (!roleConfirmed || normalizedRoleReason.length === 0) {
      onTerminalMessage(
        "error",
        "Confirm the access change and provide a reason.",
      );
      return;
    }
    if (
      !shouldAllowMemberFormSubmit(
        "role",
        { profile: profileDirty, status: statusDirty, role: roleDirty },
        () =>
          window.confirm(
            "Discard unsaved member changes before changing this role?",
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
              : "Member role is already up to date.",
          );
          router.refresh();
          return;
        }
        onTerminalMessage("error", result.error.message);
      } catch {
        onTerminalMessage(
          "error",
          "The member service is temporarily unavailable. Try again.",
        );
      }
    });
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
          <dt>Versions</dt>
          <dd>
            profile {member.profileVersion} · contact{" "}
            {privateContact.contactVersion} · membership{" "}
            {member.membershipVersion}
          </dd>
        </div>
      </dl>

      <form className="member-edit-form" onSubmit={submitEdit} noValidate>
        <fieldset disabled={pending || !canEdit}>
          <legend>Profile and private contacts</legend>
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
            <legend>Private contact detail (audited read)</legend>
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
            <span>Reason (optional audit note)</span>
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

      {member.status === "pending" ? (
        <p className="field-help">
          Pending members must accept their invitation before activation
          controls are available.
        </p>
      ) : (
        <form className="member-status-form" onSubmit={submitStatus} noValidate>
          <fieldset disabled={pending || !canChangeStatus}>
            <legend>Membership status</legend>
            {restrictedTarget ? (
              <p className="field-help">
                Coordinator access cannot change an administrator record.
              </p>
            ) : null}
            {member.membershipId === actorMembershipId ? (
              <p className="field-help">
                You cannot change your own membership status.
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
                I understand this changes the member&apos;s ability to RSVP and
                receive notifications.
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
              <span>
                I understand this changes the member&apos;s access immediately.
              </span>
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
                Choose a different role, enter a reason, and confirm the
                immediate access change before saving.
              </p>
            ) : null}
          </fieldset>
        </form>
      ) : null}

      {dirty ? (
        <p className="field-help" role="status">
          Unsaved member changes will be confirmed before leaving this editor.
        </p>
      ) : null}
    </div>
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

function formatMemberName(
  member: Pick<ManageableMember, "firstName" | "lastName">,
) {
  return `${member.firstName} ${member.lastName}`.trim() || "Name needed";
}

function formatRole(role: ManageableMember["role"]) {
  return role[0].toUpperCase() + role.slice(1);
}
