"use client";

import Link from "next/link";
import { useActionState } from "react";

import {
  acceptInvitationAction,
  initialInvitationActionState,
} from "@/app/actions/invitations";
import { FormMessage, TextLink } from "@/components/blocks";
import { Button } from "@/components/ui/button";

export function InvitationAcceptForm() {
  const [state, formAction, pending] = useActionState(
    acceptInvitationAction,
    initialInvitationActionState,
  );

  if (state.status === "success") {
    return (
      <div
        className="mt-8 gap-3 grid justify-items-start [&_[data-slot='button']]:mt-1"
        role="status"
      >
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
    <form action={formAction} className="mt-8 gap-5 grid max-w-120">
      <FormMessage aria-live="polite" data-status={state.status}>
        {state.message}
      </FormMessage>
      <Button type="submit" disabled={pending}>
        {pending ? "Accepting…" : "Accept invitation"}
      </Button>
      <TextLink href="/sign-in?next=%2Finvitations%2Faccept">
        Use a different account
      </TextLink>
    </form>
  );
}
