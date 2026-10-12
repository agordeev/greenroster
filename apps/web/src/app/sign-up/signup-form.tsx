"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";

import { initialAuthFormState } from "@/app/actions/auth-state";
import { registerOrganizerAction } from "@/app/actions/auth";
import { Field } from "@/components/blocks";
import { MINIMUM_PASSWORD_LENGTH } from "@/lib/auth/auth-validation";

export function OrganizerSignupForm() {
  const [state, formAction, pending] = useActionState(
    registerOrganizerAction,
    initialAuthFormState,
  );
  const [showPassword, setShowPassword] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (state.fieldErrors?.email) emailRef.current?.focus();
    else if (state.fieldErrors?.password) passwordRef.current?.focus();
  }, [state]);

  if (state.status === "success") {
    return (
      <div className="invitation-action-success" role="status">
        <p className="form-message" data-status="success">
          {state.message}
        </p>
        <Link className="primary-button button-link" href="/sign-up/finish">
          Continue to group setup
        </Link>
      </div>
    );
  }

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
            state.fieldErrors?.email ? "email-error" : undefined
          }
          required
        />
        {state.fieldErrors?.email ? (
          <p id="email-error" className="field-error">
            Enter a valid account e-mail.
          </p>
        ) : null}
      </div>

      <div className="field-group">
        <div className="label-row">
          <label htmlFor="password">Password</label>
          <button
            className="text-button"
            type="button"
            onClick={() => setShowPassword((current) => !current)}
            aria-controls="password confirmPassword"
            aria-pressed={showPassword}
          >
            {showPassword ? "Hide" : "Show"}
          </button>
        </div>
        <input
          id="password"
          ref={passwordRef}
          name="password"
          type={showPassword ? "text" : "password"}
          autoComplete="new-password"
          aria-describedby="password-help"
          required
        />
        <p id="password-help" className="field-help">
          Use a password of at least {MINIMUM_PASSWORD_LENGTH} characters.
        </p>
      </div>

      <Field id="confirmPassword" label="Confirm password">
        <input
          id="confirmPassword"
          name="confirmPassword"
          type={showPassword ? "text" : "password"}
          autoComplete="new-password"
          required
        />
      </Field>

      <label className="confirmation-row">
        <input name="acceptedTerms" type="checkbox" required />
        <span>
          I accept the current <Link href="/terms">Terms of Use</Link>.
        </span>
      </label>
      <label className="confirmation-row">
        <input name="acceptedPrivacy" type="checkbox" required />
        <span>
          I accept the current <Link href="/privacy">Privacy Policy</Link>.
        </span>
      </label>

      <p className="form-message" aria-live="polite" data-status={state.status}>
        {state.message}
      </p>
      <button className="primary-button" type="submit" disabled={pending}>
        {pending ? "Creating your account…" : "Create your account"}
      </button>
    </form>
  );
}
