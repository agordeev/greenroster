"use client";

import Link from "next/link";
import { useActionState } from "react";

import {
  acceptInvitationAction,
  initialInvitationActionState,
} from "@/app/actions/invitations";
import { FormMessage } from "@/components/blocks";
import { Button } from "@/components/ui/button";

export function InvitationAcceptForm() {
  const [state, formAction, pending] = useActionState(
    acceptInvitationAction,
    initialInvitationActionState,
  );

  if (state.status === "success") {
    return (
      <div className="invitation-action-success" role="status">
        <FormMessage tone="success" data-status="success">
          {state.message}
        </FormMessage>
        <Button asChild>
          <Link href="/member/first-run">Confirm profile and continue</Link>
        </Button>
      </div>
    );
  }

  return (
    <form action={formAction} className="auth-form invitation-action-form">
      <FormMessage aria-live="polite" data-status={state.status}>
        {state.message}
      </FormMessage>
      <Button type="submit" disabled={pending}>
        {pending ? "Accepting…" : "Accept invitation"}
      </Button>
      <Link
        className="secondary-link"
        href="/sign-in?next=%2Finvitations%2Faccept"
      >
        Use a different account
      </Link>
    </form>
  );
}
