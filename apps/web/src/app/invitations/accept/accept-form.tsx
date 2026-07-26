"use client";

import Link from "next/link";
import { useActionState } from "react";

import {
  acceptInvitationAction,
  initialInvitationActionState,
} from "@/app/actions/invitations";

export function InvitationAcceptForm() {
  const [state, formAction, pending] = useActionState(
    acceptInvitationAction,
    initialInvitationActionState,
  );

  if (state.status === "success") {
    return (
      <div className="invitation-action-success" role="status">
        <p className="form-message" data-status="success">
          {state.message}
        </p>
        <Link className="primary-button button-link" href="/member/first-run">
          Confirm profile and continue
        </Link>
      </div>
    );
  }

  return (
    <form action={formAction} className="auth-form invitation-action-form">
      <p className="form-message" aria-live="polite" data-status={state.status}>
        {state.message}
      </p>
      <button className="primary-button" type="submit" disabled={pending}>
        {pending ? "Accepting…" : "Accept invitation"}
      </button>
      <Link
        className="secondary-link"
        href="/sign-in?next=%2Finvitations%2Faccept"
      >
        Use a different account
      </Link>
    </form>
  );
}
