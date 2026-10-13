"use client";

import { useActionState, useEffect, useRef } from "react";

import { requestAccountEmailChangeAction } from "@/app/actions/account";
import { initialAccountEmailChangeState } from "@/lib/auth/account-email-change";
import { FieldError, FieldHelp, FormMessage } from "@/components/blocks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";

export function AccountEmailForm({
  currentEmail,
}: Readonly<{ currentEmail: string }>) {
  const [state, formAction, pending] = useActionState(
    requestAccountEmailChangeAction,
    initialAccountEmailChangeState,
  );
  const emailRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (state.fieldErrors?.email) emailRef.current?.focus();
  }, [state]);

  return (
    <form action={formAction} className="mt-6 gap-5 grid max-w-120" noValidate>
      <dl className="m-0 p-4 border border-border/50 rounded-lg [&_dd]:mx-0 [&_dd]:mt-[0.35rem] [&_dd]:mb-0 [&_dd]:wrap-anywhere [&_dt]:text-muted-foreground [&_dt]:font-mono [&_dt]:text-[0.6875rem] [&_dt]:tracking-[0.08em] [&_dt]:uppercase">
        <div>
          <dt>Current account e-mail</dt>
          <dd>{currentEmail}</dd>
        </div>
      </dl>

      <div
        className="gap-2 grid [&>label]:text-[0.8125rem] [&>label]:font-bold [&>label]:tracking-[0.015em] [&>span]:text-[0.8125rem] [&>span]:font-bold [&>span]:tracking-[0.015em]"
        data-slot="field"
      >
        <label htmlFor="new-account-email">New account e-mail</label>
        <Input
          id="new-account-email"
          ref={emailRef}
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          aria-invalid={Boolean(state.fieldErrors?.email)}
          aria-describedby={
            state.fieldErrors?.email
              ? "new-account-email-error new-account-email-help"
              : "new-account-email-help"
          }
          required
        />
        <FieldHelp id="new-account-email-help">
          This changes the address you sign in with, and where we send recovery
          links and GreenRoster notifications.
        </FieldHelp>
        {state.fieldErrors?.email ? (
          <FieldError id="new-account-email-error">
            {state.fieldErrors.email[0]}
          </FieldError>
        ) : null}
      </div>

      <label className="gap-[0.6rem] flex items-start text-muted-foreground leading-[1.5]">
        <Checkbox name="confirmed" value="true" required />
        <span>
          I understand my e-mail won&apos;t change until I follow the
          confirmation links.
        </span>
      </label>
      {state.fieldErrors?.confirmed ? (
        <FieldError>Tick the box to continue.</FieldError>
      ) : null}

      <FormMessage aria-live="polite" data-status={state.status}>
        {state.message}
      </FormMessage>

      <Button type="submit" disabled={pending}>
        {pending ? "Sending…" : "Change account e-mail"}
      </Button>
    </form>
  );
}
