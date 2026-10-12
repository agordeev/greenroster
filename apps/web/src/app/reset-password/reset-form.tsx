"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";

import { updatePasswordAction } from "@/app/actions/auth";
import { initialAuthFormState } from "@/app/actions/auth-state";
import { MINIMUM_PASSWORD_LENGTH } from "@/lib/auth/auth-validation";

export function ResetForm() {
  const [state, formAction, pending] = useActionState(
    updatePasswordAction,
    initialAuthFormState,
  );
  const [showPassword, setShowPassword] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);
  const confirmPasswordRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (state.fieldErrors?.password) passwordRef.current?.focus();
    else if (state.fieldErrors?.confirmPassword) {
      confirmPasswordRef.current?.focus();
    }
  }, [state]);

  return (
    <form action={formAction} className="auth-form" noValidate>
      <div className="field-group">
        <div className="label-row">
          <label htmlFor="password">New password</label>
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
          aria-invalid={Boolean(state.fieldErrors?.password)}
          aria-describedby={
            state.fieldErrors?.password ? "new-password-error" : undefined
          }
          required
        />
        {state.fieldErrors?.password ? (
          <p id="new-password-error" className="field-error">
            Use at least {MINIMUM_PASSWORD_LENGTH} characters.
          </p>
        ) : null}
      </div>
      <div className="field-group">
        <label htmlFor="confirmPassword">Confirm new password</label>
        <input
          id="confirmPassword"
          ref={confirmPasswordRef}
          name="confirmPassword"
          type={showPassword ? "text" : "password"}
          autoComplete="new-password"
          aria-invalid={Boolean(state.fieldErrors?.confirmPassword)}
          aria-describedby={
            state.fieldErrors?.confirmPassword
              ? "confirm-password-error"
              : undefined
          }
          required
        />
        {state.fieldErrors?.confirmPassword ? (
          <p id="confirm-password-error" className="field-error">
            Passwords must match.
          </p>
        ) : null}
      </div>
      <p className="form-message" aria-live="polite" data-status={state.status}>
        {state.message}
      </p>
      {state.status === "success" ? (
        <Link className="primary-button button-link" href="/sign-in">
          Return to sign in
        </Link>
      ) : (
        <button className="primary-button" type="submit" disabled={pending}>
          {pending ? "Updating…" : "Update password"}
        </button>
      )}
    </form>
  );
}
