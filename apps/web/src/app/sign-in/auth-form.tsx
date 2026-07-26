"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";

import { signInAction } from "@/app/actions/auth";
import { initialAuthFormState } from "@/app/actions/auth-state";

export function AuthForm() {
  const [state, formAction, pending] = useActionState(
    signInAction,
    initialAuthFormState,
  );
  const [showPassword, setShowPassword] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (state.fieldErrors?.email) emailRef.current?.focus();
    else if (state.fieldErrors?.password) passwordRef.current?.focus();
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
            aria-controls="password"
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
          autoComplete="current-password"
          aria-invalid={Boolean(state.fieldErrors?.password)}
          aria-describedby={
            state.fieldErrors?.password ? "password-error" : undefined
          }
          required
        />
        {state.fieldErrors?.password ? (
          <p id="password-error" className="field-error">
            Enter your password.
          </p>
        ) : null}
      </div>

      <p className="form-message" aria-live="polite" data-status={state.status}>
        {state.message}
      </p>

      <button className="primary-button" type="submit" disabled={pending}>
        {pending ? "Verifying…" : "Sign in"}
      </button>

      <Link className="secondary-link" href="/recover-password">
        Forgot your password?
      </Link>
    </form>
  );
}
