"use client";

import { useActionState, useEffect, useRef } from "react";

import { requestAccountEmailChangeAction } from "@/app/actions/account";
import { initialAccountEmailChangeState } from "@/lib/auth/account-email-change";

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
    <form
      action={formAction}
      className="auth-form account-email-form"
      noValidate
    >
      <dl className="account-email-current">
        <div>
          <dt>Current account e-mail</dt>
          <dd>{currentEmail}</dd>
        </div>
      </dl>

      <div className="field-group">
        <label htmlFor="new-account-email">New account e-mail</label>
        <input
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
        <p id="new-account-email-help" className="field-help">
          This changes the address you sign in with, and where we send recovery
          links and GreenRoster notifications. Your memberships stay the same.
        </p>
        {state.fieldErrors?.email ? (
          <p id="new-account-email-error" className="field-error">
            {state.fieldErrors.email[0]}
          </p>
        ) : null}
      </div>

      <label className="account-email-confirmation">
        <input name="confirmed" type="checkbox" value="true" required />
        <span>
          I understand the change is not complete until I finish the
          confirmation steps.
        </span>
      </label>
      {state.fieldErrors?.confirmed ? (
        <p className="field-error">Tick the box to continue.</p>
      ) : null}

      <p className="form-message" aria-live="polite" data-status={state.status}>
        {state.message}
      </p>

      <button className="primary-button" type="submit" disabled={pending}>
        {pending ? "Requesting confirmation…" : "Change account e-mail"}
      </button>
    </form>
  );
}
