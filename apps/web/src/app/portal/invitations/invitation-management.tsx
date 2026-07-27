"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { FormEvent, useRef, useState, useTransition } from "react";

import {
  correctMembershipInvitationAction,
  regenerateMembershipInvitationAction,
  revokeMembershipInvitationAction,
} from "@/app/actions/memberships";
import type { ManageableInvitation } from "@/lib/invitations/invitation-lifecycle";
import {
  describeInvitationDelivery,
  type InvitationDeliveryFilter,
} from "@/domain/portal-list-filters";

export function InvitationManagement({
  invitations,
  deliveryFilter = null,
  role,
}: Readonly<{
  invitations: readonly ManageableInvitation[];
  deliveryFilter?: InvitationDeliveryFilter | null;
  role: "member" | "coordinator" | "administrator";
}>) {
  if (invitations.length === 0) {
    return (
      <div className="invitation-management-empty">
        <h2>
          {deliveryFilter === "action-required"
            ? "No invitation delivery issues"
            : "No pending invitations"}
        </h2>
        <p>
          {deliveryFilter === "action-required"
            ? "No pending invitation currently has a failed or suppressed e-mail delivery."
            : "New invitations will appear here while they await acceptance."}
        </p>
        {deliveryFilter === "action-required" ? (
          <Link className="secondary-link" href="/portal/invitations">
            View all pending invitations
          </Link>
        ) : null}
      </div>
    );
  }

  return (
    <div
      className="invitation-management"
      aria-label={
        deliveryFilter === "action-required"
          ? "Action-required invitation deliveries"
          : "Pending invitations"
      }
    >
      {invitations.map((invitation) => (
        <InvitationCard
          key={invitation.invitationId}
          invitation={invitation}
          canCorrectAddress={role === "administrator"}
        />
      ))}
    </div>
  );
}

function InvitationCard({
  invitation,
  canCorrectAddress,
}: Readonly<{
  invitation: ManageableInvitation;
  canCorrectAddress: boolean;
}>) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [correctionEmail, setCorrectionEmail] = useState(
    invitation.invitedEmail,
  );
  const [correctionReason, setCorrectionReason] = useState("");
  const [regenerationReason, setRegenerationReason] = useState("");
  const [revokeReason, setRevokeReason] = useState("");
  const [message, setMessage] = useState("");
  const [messageStatus, setMessageStatus] = useState<"success" | "error">(
    "error",
  );
  const operationIds = useRef<
    Partial<Record<"correct" | "regenerate" | "revoke", string>>
  >({});
  const operationPayloads = useRef<
    Partial<Record<"correct" | "regenerate" | "revoke", string>>
  >({});
  const id = invitation.invitationId;

  function submit(
    event: FormEvent<HTMLFormElement>,
    operation: "correct" | "regenerate" | "revoke",
  ) {
    event.preventDefault();
    setMessage("");
    setMessageStatus("error");
    const form = new FormData(event.currentTarget);
    const confirmed = form.get("confirmed") === "on";
    const reason = String(form.get("reason") ?? "");
    const invitedEmail =
      operation === "correct"
        ? String(form.get("invitedEmail") ?? "")
        : undefined;
    const payloadFingerprint = JSON.stringify({
      confirmed,
      invitedEmail,
      reason,
    });
    if (operationPayloads.current[operation] !== payloadFingerprint) {
      operationIds.current[operation] = crypto.randomUUID();
      operationPayloads.current[operation] = payloadFingerprint;
    }
    const operationId = operationIds.current[operation] ?? crypto.randomUUID();
    operationIds.current[operation] = operationId;
    const input = {
      invitationId: id,
      confirmed,
      reason,
      operationId,
      ...(invitedEmail !== undefined ? { invitedEmail } : {}),
    };

    startTransition(async () => {
      try {
        const result =
          operation === "correct"
            ? await correctMembershipInvitationAction(input)
            : operation === "regenerate"
              ? await regenerateMembershipInvitationAction(input)
              : await revokeMembershipInvitationAction(input);

        if (result.ok) {
          delete operationIds.current[operation];
          if (operation === "revoke") {
            setMessage("The invitation was revoked.");
            setMessageStatus("success");
          } else {
            if (!("invitationUrl" in result.data)) {
              setMessageStatus("error");
              setMessage(
                "The invitation service returned an incomplete result.",
              );
              return;
            }
            setMessageStatus("success");
            setMessage(
              operation === "correct"
                ? "The address was corrected and a fresh invitation was queued."
                : "A fresh invitation was queued.",
            );
          }
          window.setTimeout(() => router.refresh(), 500);
          delete operationPayloads.current[operation];
          return;
        }

        if (result.error.code === "authentication_required") {
          router.replace("/sign-in?status=session-expired");
          return;
        }
        setMessageStatus("error");
        setMessage(result.error.message);
      } catch {
        setMessageStatus("error");
        setMessage(
          "The invitation service is temporarily unavailable. Try again.",
        );
      }
    });
  }

  const delivery = describeInvitationDelivery(invitation);

  return (
    <article className="invitation-card" aria-labelledby={`invitation-${id}`}>
      <div className="invitation-card-heading">
        <div>
          <p className="ledger-kicker">Pending member</p>
          <h2 id={`invitation-${id}`}>
            {invitation.memberFirstName} {invitation.memberLastName}
          </h2>
        </div>
        <span className="invitation-status">
          {formatStatus(invitation.status)}
        </span>
      </div>
      <dl className="invitation-summary">
        <div>
          <dt>Invited address</dt>
          <dd>{invitation.invitedEmail}</dd>
        </div>
        <div>
          <dt>Expires</dt>
          <dd>{formatDate(invitation.expiresAt)}</dd>
        </div>
        <div>
          <dt>Delivery</dt>
          <dd>{delivery}</dd>
        </div>
      </dl>

      <div className="invitation-actions">
        <form onSubmit={(event) => submit(event, "regenerate")} noValidate>
          <h3>Regenerate link</h3>
          <label className="field-group" htmlFor={`regenerate-reason-${id}`}>
            <span>Reason</span>
            <input
              id={`regenerate-reason-${id}`}
              name="reason"
              value={regenerationReason}
              onChange={(event) => setRegenerationReason(event.target.value)}
              required
            />
          </label>
          <ConfirmationField id={`regenerate-confirm-${id}`} />
          <button className="secondary-button" type="submit" disabled={pending}>
            {pending ? "Working…" : "Regenerate"}
          </button>
        </form>

        {canCorrectAddress ? (
          <form onSubmit={(event) => submit(event, "correct")} noValidate>
            <h3>Correct address</h3>
            <label className="field-group" htmlFor={`correct-email-${id}`}>
              <span>New invited address</span>
              <input
                id={`correct-email-${id}`}
                name="invitedEmail"
                type="email"
                value={correctionEmail}
                onChange={(event) => setCorrectionEmail(event.target.value)}
                autoComplete="email"
                required
              />
            </label>
            <label className="field-group" htmlFor={`correct-reason-${id}`}>
              <span>Reason</span>
              <input
                id={`correct-reason-${id}`}
                name="reason"
                value={correctionReason}
                onChange={(event) => setCorrectionReason(event.target.value)}
                required
              />
            </label>
            <ConfirmationField id={`correct-confirm-${id}`} />
            <button
              className="secondary-button"
              type="submit"
              disabled={pending}
            >
              {pending ? "Working…" : "Correct and resend"}
            </button>
          </form>
        ) : null}

        <form onSubmit={(event) => submit(event, "revoke")} noValidate>
          <h3>Revoke invitation</h3>
          <label className="field-group" htmlFor={`revoke-reason-${id}`}>
            <span>Reason</span>
            <input
              id={`revoke-reason-${id}`}
              name="reason"
              value={revokeReason}
              onChange={(event) => setRevokeReason(event.target.value)}
              required
            />
          </label>
          <ConfirmationField id={`revoke-confirm-${id}`} />
          <button className="danger-button" type="submit" disabled={pending}>
            {pending ? "Working…" : "Revoke"}
          </button>
        </form>
      </div>

      <div
        className="form-message"
        aria-live="polite"
        data-status={message ? messageStatus : undefined}
      >
        {message}
      </div>
      {invitation.deliveryFailureReason ? (
        <p className="field-help">
          Delivery note: {invitation.deliveryFailureReason}
        </p>
      ) : null}
    </article>
  );
}

function ConfirmationField({ id }: Readonly<{ id: string }>) {
  return (
    <label className="invitation-confirmation" htmlFor={id}>
      <input id={id} name="confirmed" type="checkbox" required />
      <span>I understand this changes the single-use invitation.</span>
    </label>
  );
}

function formatStatus(status: ManageableInvitation["status"]) {
  return status === "expired" ? "Expired · resend available" : "Pending";
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
