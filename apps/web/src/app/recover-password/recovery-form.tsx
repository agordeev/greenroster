"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef } from "react";

import { requestPasswordResetAction } from "@/app/actions/auth";
import { initialAuthFormState } from "@/app/actions/auth-state";
import { FormMessage } from "@/components/blocks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function RecoveryForm() {
  const [state, formAction, pending] = useActionState(
    requestPasswordResetAction,
    initialAuthFormState,
  );
  const emailRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (state.fieldErrors?.email) emailRef.current?.focus();
  }, [state]);

  return (
    <form action={formAction} className="auth-form" noValidate>
      <div className="field-group">
        <label htmlFor="email">Account e-mail</label>
        <Input
          id="email"
          ref={emailRef}
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          aria-invalid={Boolean(state.fieldErrors?.email)}
          aria-describedby={
            state.fieldErrors?.email ? "recovery-email-error" : undefined
          }
          required
        />
        {state.fieldErrors?.email ? (
          <p id="recovery-email-error" className="field-error">
            Enter a valid account e-mail.
          </p>
        ) : null}
      </div>
      <FormMessage
        tone={state.status === "success" ? "success" : "error"}
        aria-live="polite"
        data-status={state.status}
      >
        {state.message}
      </FormMessage>
      <Button type="submit" disabled={pending}>
        {pending ? "Sending…" : "Send recovery link"}
      </Button>
      <Link className="secondary-link" href="/sign-in">
        Return to sign in
      </Link>
    </form>
  );
}
