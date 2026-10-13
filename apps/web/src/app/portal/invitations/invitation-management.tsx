"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useRef, useState, useTransition } from "react";

import {
  correctMembershipInvitationAction,
  regenerateMembershipInvitationAction,
  revokeMembershipInvitationAction,
} from "@/app/actions/memberships";
import { FieldHelp, FormMessage, Kicker, TextLink } from "@/components/blocks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
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
      <div className="mt-10 p-6 border rounded-lg [&_[data-slot=text-link]]:mt-4 [&_[data-slot=text-link]]:inline-block [&_h2]:m-0 [&_h2]:text-[1.5rem] [&_h2]:font-semibold [&_p]:mb-0 [&_p]:text-muted-foreground">
        <h2>
          {deliveryFilter === "action-required"
            ? "No invitations need attention"
            : "No pending invitations"}
        </h2>
        <p>
          {deliveryFilter === "action-required"
            ? "No pending invitations have delivery problems."
            : "New invitations appear here until they are accepted."}
        </p>
        {deliveryFilter === "action-required" ? (
          <TextLink href="/portal/invitations">
            View all pending invitations
          </TextLink>
        ) : null}
      </div>
    );
  }

  return (
    <div
      className="mt-10 gap-6 grid"
      aria-label={
        deliveryFilter === "action-required"
          ? "Invitations with email problems"
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
            setMessage("The invitation was cancelled.");
            setMessageStatus("success");
          } else {
            if (!("invitationUrl" in result.data)) {
              setMessageStatus("error");
              setMessage("We couldn't confirm that. Refresh and try again.");
              return;
            }
            setMessageStatus("success");
            setMessage(
              operation === "correct"
                ? "The address was fixed and a new invitation is on its way."
                : "A new invitation is on its way.",
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
        setMessage("We couldn't do that right now. Try again in a moment.");
      }
    });
  }

  const delivery = describeInvitationDelivery(invitation);

  return (
    <article
      className="p-6 gap-5 border grid rounded-lg [&_[data-slot='alert']]:gap-2 [&_[data-slot='alert']]:grid! [&_[data-slot='alert']_a]:text-primary [&_[data-slot='alert']_a]:font-bold [&_[data-slot='alert']_a]:underline-offset-[0.2em] [&_[data-slot=invitation-summary]]:mx-0 [&_[data-slot=invitation-summary]]:mb-0 [&_[data-slot=invitation-summary]]:pt-4 [&_[data-slot=invitation-summary]]:mt-0! [&_[data-slot=invitation-summary]_dd]:mx-0 [&_[data-slot=invitation-summary]_dd]:mt-1.5 [&_[data-slot=invitation-summary]_dd]:mb-0 [&_[data-slot=invitation-summary]_dd]:text-muted-foreground [&_[data-slot=invitation-summary]_dd]:wrap-anywhere [&_[data-slot=invitation-summary]_dt]:text-muted-foreground [&_[data-slot=invitation-summary]_dt]:font-mono [&_[data-slot=invitation-summary]_dt]:text-[0.6875rem] [&_[data-slot=invitation-summary]_dt]:tracking-[0.08em] [&_[data-slot=invitation-summary]_dt]:uppercase"
      aria-labelledby={`invitation-${id}`}
    >
      <div className="gap-4 flex items-start justify-between [&_h2]:mx-0 [&_h2]:mb-0 [&_h2]:text-[1.5rem] [&_h2]:font-semibold [&_h2]:mt-1.5!">
        <div>
          <Kicker>Pending member</Kicker>
          <h2 id={`invitation-${id}`}>
            {invitation.memberFirstName} {invitation.memberLastName}
          </h2>
        </div>
        <span className="text-primary font-mono text-[0.6875rem] font-bold tracking-[0.06em] text-right uppercase">
          {formatStatus(invitation.status)}
        </span>
      </div>
      <dl
        className="mx-0 mt-9 mb-0 pt-6 border-t grid grid-cols-2 gap-y-4 gap-x-6 max-[480px]:grid-cols-[1fr] [&_dd]:mx-0 [&_dd]:mt-[0.3rem] [&_dd]:mb-0 [&_dd]:text-foreground [&_dd]:wrap-anywhere [&_div]:min-w-0 [&_dt]:text-muted-foreground [&_dt]:font-mono [&_dt]:text-[0.6875rem] [&_dt]:tracking-[0.1em] [&_dt]:uppercase"
        data-slot="invitation-summary"
      >
        <div>
          <dt>Invited e-mail</dt>
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

      <div className="gap-4 grid grid-cols-3 max-[720px]:grid-cols-[1fr] [&_form]:pt-4 [&_form]:gap-3 [&_form]:border-t [&_form]:border-t-border/50 [&_form]:grid [&_form]:content-start [&_h3]:m-0 [&_h3]:text-[1.125rem] [&_h3]:font-semibold">
        <form onSubmit={(event) => submit(event, "regenerate")} noValidate>
          <h3>Send a new link</h3>
          <label
            className="gap-2 grid [&>label]:text-[0.8125rem] [&>label]:font-bold [&>label]:tracking-[0.015em] [&>span]:text-[0.8125rem] [&>span]:font-bold [&>span]:tracking-[0.015em]"
            data-slot="field"
            htmlFor={`regenerate-reason-${id}`}
          >
            <span>Reason</span>
            <Input
              id={`regenerate-reason-${id}`}
              name="reason"
              value={regenerationReason}
              onChange={(event) => setRegenerationReason(event.target.value)}
              required
            />
          </label>
          <ConfirmationField id={`regenerate-confirm-${id}`} />
          <Button variant="outline" type="submit" disabled={pending}>
            {pending ? "Working…" : "Send new link"}
          </Button>
        </form>

        {canCorrectAddress ? (
          <form onSubmit={(event) => submit(event, "correct")} noValidate>
            <h3>Fix the e-mail address</h3>
            <label
              className="gap-2 grid [&>label]:text-[0.8125rem] [&>label]:font-bold [&>label]:tracking-[0.015em] [&>span]:text-[0.8125rem] [&>span]:font-bold [&>span]:tracking-[0.015em]"
              data-slot="field"
              htmlFor={`correct-email-${id}`}
            >
              <span>New email address</span>
              <Input
                id={`correct-email-${id}`}
                name="invitedEmail"
                type="email"
                value={correctionEmail}
                onChange={(event) => setCorrectionEmail(event.target.value)}
                autoComplete="email"
                required
              />
            </label>
            <label
              className="gap-2 grid [&>label]:text-[0.8125rem] [&>label]:font-bold [&>label]:tracking-[0.015em] [&>span]:text-[0.8125rem] [&>span]:font-bold [&>span]:tracking-[0.015em]"
              data-slot="field"
              htmlFor={`correct-reason-${id}`}
            >
              <span>Reason</span>
              <Input
                id={`correct-reason-${id}`}
                name="reason"
                value={correctionReason}
                onChange={(event) => setCorrectionReason(event.target.value)}
                required
              />
            </label>
            <ConfirmationField id={`correct-confirm-${id}`} />
            <Button variant="outline" type="submit" disabled={pending}>
              {pending ? "Working…" : "Fix and resend"}
            </Button>
          </form>
        ) : null}

        <form onSubmit={(event) => submit(event, "revoke")} noValidate>
          <h3>Cancel invitation</h3>
          <label
            className="gap-2 grid [&>label]:text-[0.8125rem] [&>label]:font-bold [&>label]:tracking-[0.015em] [&>span]:text-[0.8125rem] [&>span]:font-bold [&>span]:tracking-[0.015em]"
            data-slot="field"
            htmlFor={`revoke-reason-${id}`}
          >
            <span>Reason</span>
            <Input
              id={`revoke-reason-${id}`}
              name="reason"
              value={revokeReason}
              onChange={(event) => setRevokeReason(event.target.value)}
              required
            />
          </label>
          <ConfirmationField id={`revoke-confirm-${id}`} />
          <Button variant="destructive" type="submit" disabled={pending}>
            {pending ? "Working…" : "Cancel invitation"}
          </Button>
        </form>
      </div>

      <FormMessage
        tone={messageStatus === "success" ? "success" : "error"}
        aria-live="polite"
        data-status={message ? messageStatus : undefined}
      >
        {message}
      </FormMessage>
      {invitation.deliveryFailureReason ? (
        <FieldHelp>Delivery note: {invitation.deliveryFailureReason}</FieldHelp>
      ) : null}
    </article>
  );
}

function ConfirmationField({ id }: Readonly<{ id: string }>) {
  return (
    <label
      className="gap-2 flex items-start text-muted-foreground text-[0.75rem] leading-[1.45]"
      htmlFor={id}
    >
      <Checkbox id={id} name="confirmed" required />
      <span>I want to make this change.</span>
    </label>
  );
}

function formatStatus(status: ManageableInvitation["status"]) {
  return status === "expired" ? "Expired · send a new link" : "Pending";
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
