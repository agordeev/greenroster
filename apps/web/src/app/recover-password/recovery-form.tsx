"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef } from "react";

import { requestPasswordResetAction } from "@/app/actions/auth";
import { initialAuthFormState } from "@/app/actions/auth-state";

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
        <input
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
      <p className="form-message" aria-live="polite" data-status={state.status}>
        {state.message}
      </p>
      <button className="primary-button" type="submit" disabled={pending}>
        {pending ? "Sending…" : "Send recovery link"}
      </button>
      <Link className="secondary-link" href="/sign-in">
        Return to sign in
      </Link>
    </form>
  );
}
