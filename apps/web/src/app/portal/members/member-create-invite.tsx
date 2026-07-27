"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import type { FormEvent } from "react";

import {
  createPendingMemberProfileAction,
  issueMembershipInvitationAction,
} from "@/app/actions/memberships";
import { signInPath } from "@/lib/auth/safe-return-path";
import type { MemberRole } from "@/lib/memberships/member-management";

import {
  buildMemberProfileCreatePayload,
  canCreatePendingMember,
  emptyMemberCreateInviteDraft,
  memberCreateInviteRecoveryStorageKey,
  parseMemberCreateInviteRecovery,
  retainMemberCreateInviteOperationId,
  serializeMemberCreateInviteRecovery,
  shouldResetMemberCreateConfirmation,
  type MemberCreateInviteDraft,
  type MemberCreateInviteOperationState,
  type MemberCreateInvitePhase,
  type TeeLocation,
} from "./member-create-invite-state";

const emptyOperationState: MemberCreateInviteOperationState = {
  fingerprint: null,
  operationId: null,
};

export function MemberCreateInvite({ role }: Readonly<{ role: MemberRole }>) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState<MemberCreateInviteDraft>(
    emptyMemberCreateInviteDraft,
  );
  const [phase, setPhase] = useState<MemberCreateInvitePhase>("idle");
  const [message, setMessage] = useState("");
  const [messageStatus, setMessageStatus] = useState<"success" | "error">(
    "error",
  );
  const [createConfirmed, setCreateConfirmed] = useState(false);
  const [inviteConfirmed, setInviteConfirmed] = useState(false);
  const [createdMembershipId, setCreatedMembershipId] = useState<string | null>(
    null,
  );
  const createOperation = useRef(emptyOperationState);
  const inviteOperation = useRef(emptyOperationState);

  useEffect(() => {
    let cancelled = false;
    let recovery: ReturnType<typeof parseMemberCreateInviteRecovery>;
    try {
      recovery = parseMemberCreateInviteRecovery(
        window.sessionStorage.getItem(memberCreateInviteRecoveryStorageKey),
      );
    } catch {
      recovery = null;
    }
    if (!recovery) return;
    try {
      window.sessionStorage.removeItem(memberCreateInviteRecoveryStorageKey);
    } catch {
      // The in-memory recovery below remains usable when storage is blocked.
    }
    queueMicrotask(() => {
      if (cancelled) return;
      setDraft(recovery.draft);
      setCreatedMembershipId(recovery.createdMembershipId);
      setCreateConfirmed(false);
      setInviteConfirmed(false);
      setPhase(recovery.createdMembershipId ? "ready" : "idle");
      setMessageStatus("success");
      setMessage("Draft restored. Confirm each action before retrying.");
      createOperation.current = recovery.createOperation;
      inviteOperation.current = recovery.inviteOperation;
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!canCreatePendingMember(role)) {
    return null;
  }

  const memberCreated = createdMembershipId !== null;
  const busy = pending || phase === "creating" || phase === "inviting";

  function update<K extends keyof MemberCreateInviteDraft>(
    key: K,
    value: MemberCreateInviteDraft[K],
  ) {
    if (shouldResetMemberCreateConfirmation(createdMembershipId)) {
      setCreateConfirmed(false);
      setPhase("idle");
      setMessage("");
    }
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function setError(nextMessage: string) {
    setPhase(memberCreated ? "ready" : "error");
    setMessageStatus("error");
    setMessage(nextMessage);
  }

  function submitCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || memberCreated) return;

    const firstName = draft.firstName.trim();
    const lastName = draft.lastName.trim();
    const invitedEmail = normalizeEmail(draft.invitedEmail);
    if (!firstName || !lastName || !isEmail(invitedEmail)) {
      setError(
        "Enter the member's first name, last name, and a valid invite e-mail.",
      );
      return;
    }
    if (!createConfirmed) {
      setError(
        "Confirm the member details before creating the pending record.",
      );
      return;
    }

    // Keep the idempotency fingerprint identical to the profile action input.
    // The invite address belongs only to the later invitation operation.
    const payload = buildMemberProfileCreatePayload(draft);
    createOperation.current = retainMemberCreateInviteOperationId(
      createOperation.current,
      "create",
      payload,
      () => crypto.randomUUID(),
    );
    const operationId = createOperation.current.operationId;
    if (!operationId) {
      setError("The member record could not be prepared. Try again.");
      return;
    }

    setMessage("");
    setPhase("creating");
    startTransition(async () => {
      try {
        const result = await createPendingMemberProfileAction({
          ...payload,
          operationId,
        });

        if (!result.ok) {
          handleMutationError(result.error.code, result.error.message);
          return;
        }

        setCreatedMembershipId(result.data.membershipId);
        setPhase("ready");
        setMessageStatus("success");
        setMessage(
          "Pending member created. Confirm the address below to send the invitation.",
        );
      } catch {
        setError("The member service is temporarily unavailable. Try again.");
      }
    });
  }

  function submitInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !createdMembershipId) return;

    const invitedEmail = normalizeEmail(draft.invitedEmail);
    if (!isEmail(invitedEmail)) {
      setError("Enter a valid invite e-mail before sending the invitation.");
      return;
    }
    if (!inviteConfirmed) {
      setError("Confirm the invitation address before sending it.");
      return;
    }

    const payload = {
      membershipId: createdMembershipId,
      invitedEmail,
    };
    inviteOperation.current = retainMemberCreateInviteOperationId(
      inviteOperation.current,
      "invite",
      payload,
      () => crypto.randomUUID(),
    );
    const operationId = inviteOperation.current.operationId;
    if (!operationId) {
      setError("The invitation could not be prepared. Try again.");
      return;
    }

    setMessage("");
    setPhase("inviting");
    startTransition(async () => {
      try {
        const result = await issueMembershipInvitationAction({
          membershipId: createdMembershipId,
          invitedEmail,
          operationId,
        });

        if (!result.ok) {
          handleMutationError(result.error.code, result.error.message);
          return;
        }

        // The server returns a one-time URL for authorized hand-off flows. It
        // is intentionally not rendered here; administrators can manage the
        // delivery state from Invitations without exposing the token.
        setPhase("success");
        setMessageStatus("success");
        setMessage("Invitation queued. Opening the created member record…");
        clearRecoveryState();
        setDraft(emptyMemberCreateInviteDraft);
        setCreateConfirmed(false);
        setInviteConfirmed(false);
        setCreatedMembershipId(null);
        createOperation.current = emptyOperationState;
        inviteOperation.current = emptyOperationState;
        router.replace(`/portal/members?membership=${createdMembershipId}`);
      } catch {
        setError(
          "The invitation service is temporarily unavailable. Try again.",
        );
      }
    });
  }

  function handleMutationError(code: string, errorMessage: string) {
    if (code === "authentication_required") {
      preserveRecoveryState();
      router.replace(signInPath("/portal/members"));
      return;
    }
    setError(errorMessage);
  }

  function reset() {
    if (busy) return;
    clearRecoveryState();
    setDraft(emptyMemberCreateInviteDraft);
    setPhase("idle");
    setMessage("");
    setMessageStatus("error");
    setCreateConfirmed(false);
    setInviteConfirmed(false);
    setCreatedMembershipId(null);
    createOperation.current = emptyOperationState;
    inviteOperation.current = emptyOperationState;
  }

  function preserveRecoveryState() {
    try {
      window.sessionStorage.setItem(
        memberCreateInviteRecoveryStorageKey,
        serializeMemberCreateInviteRecovery({
          draft,
          createdMembershipId,
          createOperation: createOperation.current,
          inviteOperation: inviteOperation.current,
        }),
      );
    } catch {
      // Private browsing or a storage quota failure must not block sign-in.
    }
  }

  function clearRecoveryState() {
    try {
      window.sessionStorage.removeItem(memberCreateInviteRecoveryStorageKey);
    } catch {
      // Storage is best-effort recovery only.
    }
  }

  return (
    <section
      className="member-create-invite"
      aria-labelledby="member-create-title"
    >
      <div className="member-create-heading">
        <div>
          <p className="ledger-kicker">New member</p>
          <h2 id="member-create-title">Create and invite</h2>
        </div>
        <span className="member-create-step">
          {memberCreated ? "Step 2 of 2" : "Step 1 of 2"}
        </span>
      </div>
      <p className="member-create-copy">
        Create the pending membership first, then confirm the invite address in
        a separate action. The server records both operations independently.
      </p>

      <form className="member-create-form" onSubmit={submitCreate} noValidate>
        <fieldset disabled={busy || memberCreated}>
          <legend>Member details</legend>
          <div className="member-form-grid">
            <label className="field-group" htmlFor="member-create-first-name">
              <span>First name</span>
              <input
                id="member-create-first-name"
                name="firstName"
                value={draft.firstName}
                onChange={(event) => update("firstName", event.target.value)}
                autoComplete="given-name"
                required
              />
            </label>
            <label className="field-group" htmlFor="member-create-last-name">
              <span>Last name</span>
              <input
                id="member-create-last-name"
                name="lastName"
                value={draft.lastName}
                onChange={(event) => update("lastName", event.target.value)}
                autoComplete="family-name"
                required
              />
            </label>
            <label className="field-group" htmlFor="member-create-email">
              <span>Invite e-mail</span>
              <input
                id="member-create-email"
                name="invitedEmail"
                type="email"
                value={draft.invitedEmail}
                onChange={(event) => {
                  update("invitedEmail", event.target.value);
                  inviteOperation.current = emptyOperationState;
                  setInviteConfirmed(false);
                }}
                autoComplete="email"
                required
              />
            </label>
            <label className="field-group" htmlFor="member-create-tee">
              <span>Preferred tee</span>
              <select
                id="member-create-tee"
                name="teeLocation"
                value={draft.teeLocation}
                onChange={(event) =>
                  update("teeLocation", event.target.value as TeeLocation | "")
                }
              >
                <option value="">Not set</option>
                <option value="pro">Pro</option>
                <option value="back">Back</option>
                <option value="middle">Middle</option>
                <option value="front">Front</option>
              </select>
            </label>
            <label className="field-group" htmlFor="member-create-spouse-first">
              <span>Spouse first name (optional)</span>
              <input
                id="member-create-spouse-first"
                name="spouseFirstName"
                value={draft.spouseFirstName}
                onChange={(event) =>
                  update("spouseFirstName", event.target.value)
                }
              />
            </label>
            <label className="field-group" htmlFor="member-create-spouse-last">
              <span>Spouse last name (optional)</span>
              <input
                id="member-create-spouse-last"
                name="spouseLastName"
                value={draft.spouseLastName}
                onChange={(event) =>
                  update("spouseLastName", event.target.value)
                }
              />
            </label>
            <label
              className="field-group"
              htmlFor="member-create-secondary-email"
            >
              <span>Secondary e-mail (optional)</span>
              <input
                id="member-create-secondary-email"
                name="secondaryEmail"
                type="email"
                value={draft.secondaryEmail}
                onChange={(event) =>
                  update("secondaryEmail", event.target.value)
                }
                autoComplete="email"
              />
            </label>
            <label className="field-group" htmlFor="member-create-mobile-phone">
              <span>Mobile phone (optional)</span>
              <input
                id="member-create-mobile-phone"
                name="mobilePhone"
                type="tel"
                value={draft.mobilePhone}
                onChange={(event) => update("mobilePhone", event.target.value)}
                autoComplete="tel"
              />
            </label>
            <label className="member-check" htmlFor="member-create-dues">
              <input
                id="member-create-dues"
                name="duesPaid"
                type="checkbox"
                checked={draft.duesPaid}
                onChange={(event) => update("duesPaid", event.target.checked)}
              />
              <span>Dues paid</span>
            </label>
            <label className="field-group" htmlFor="member-create-reason">
              <span>Reason (optional)</span>
              <input
                id="member-create-reason"
                name="reason"
                value={draft.reason}
                onChange={(event) => update("reason", event.target.value)}
              />
            </label>
          </div>
          <fieldset className="member-contact-fieldset">
            <legend>Private contact visibility</legend>
            <div className="member-visibility-grid">
              <label
                className="member-check"
                htmlFor="member-create-secondary-visible"
              >
                <input
                  id="member-create-secondary-visible"
                  type="checkbox"
                  checked={draft.secondaryEmailVisible}
                  onChange={(event) =>
                    update("secondaryEmailVisible", event.target.checked)
                  }
                />
                <span>List secondary e-mail</span>
              </label>
              <label
                className="member-check"
                htmlFor="member-create-mobile-visible"
              >
                <input
                  id="member-create-mobile-visible"
                  type="checkbox"
                  checked={draft.mobilePhoneVisible}
                  onChange={(event) =>
                    update("mobilePhoneVisible", event.target.checked)
                  }
                />
                <span>List mobile phone</span>
              </label>
            </div>
            <small className="field-help">
              Contact details stay private unless you explicitly list them.
            </small>
          </fieldset>
          <label
            className="member-create-confirmation"
            htmlFor="member-create-confirm"
          >
            <input
              id="member-create-confirm"
              type="checkbox"
              checked={createConfirmed}
              onChange={(event) => setCreateConfirmed(event.target.checked)}
            />
            <span>
              I confirm these details are ready for a pending membership.
            </span>
          </label>
        </fieldset>
        <div className="member-create-actions">
          <button
            className="primary-button"
            type="submit"
            disabled={busy || memberCreated}
          >
            {phase === "creating" ? "Creating…" : "Create pending member"}
          </button>
          {memberCreated ? (
            <button
              className="secondary-button"
              type="button"
              onClick={reset}
              disabled={busy}
            >
              Create another member
            </button>
          ) : null}
        </div>
      </form>

      {createdMembershipId ? (
        <form className="member-invite-form" onSubmit={submitInvite} noValidate>
          <fieldset disabled={busy}>
            <legend>Send invitation</legend>
            <p>
              Membership <code>{createdMembershipId}</code> is pending. No
              invitation has been sent until this action is confirmed.
            </p>
            <label className="field-group" htmlFor="member-invite-email">
              <span>Invite e-mail</span>
              <input
                id="member-invite-email"
                name="invitedEmail"
                type="email"
                value={draft.invitedEmail}
                onChange={(event) => {
                  update("invitedEmail", event.target.value);
                  inviteOperation.current = emptyOperationState;
                  setInviteConfirmed(false);
                }}
                autoComplete="email"
                required
              />
            </label>
            <label
              className="member-create-confirmation"
              htmlFor="member-invite-confirm"
            >
              <input
                id="member-invite-confirm"
                type="checkbox"
                checked={inviteConfirmed}
                onChange={(event) => setInviteConfirmed(event.target.checked)}
              />
              <span>
                I confirm this is the address that should receive the
                invitation.
              </span>
            </label>
          </fieldset>
          <div className="member-create-actions">
            <button className="primary-button" type="submit" disabled={busy}>
              {phase === "inviting" ? "Sending…" : "Send invitation"}
            </button>
          </div>
        </form>
      ) : null}

      <div
        className="form-message"
        aria-live="polite"
        data-status={message ? messageStatus : undefined}
      >
        {message}
      </div>
    </section>
  );
}

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

function isEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}
