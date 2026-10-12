"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";

import { initialAuthFormState } from "@/app/actions/auth-state";
import { registerOrganizerAction } from "@/app/actions/auth";
import { Field, FormMessage } from "@/components/blocks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
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
        <FormMessage tone="success" data-status="success">
          {state.message}
        </FormMessage>
        <Button asChild>
          <Link href="/sign-up/finish">Continue to group setup</Link>
        </Button>
      </div>
    );
  }

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
          <Button
            variant="link"
            size="inline"
            type="button"
            onClick={() => setShowPassword((current) => !current)}
            aria-controls="password confirmPassword"
            aria-pressed={showPassword}
          >
            {showPassword ? "Hide" : "Show"}
          </Button>
        </div>
        <Input
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
        <Input
          id="confirmPassword"
          name="confirmPassword"
          type={showPassword ? "text" : "password"}
          autoComplete="new-password"
          required
        />
      </Field>

      <label className="confirmation-row">
        <Checkbox name="acceptedTerms" required />
        <span>
          I accept the current <Link href="/terms">Terms of Use</Link>.
        </span>
      </label>
      <label className="confirmation-row">
        <Checkbox name="acceptedPrivacy" required />
        <span>
          I accept the current <Link href="/privacy">Privacy Policy</Link>.
        </span>
      </label>

      <FormMessage aria-live="polite" data-status={state.status}>
        {state.message}
      </FormMessage>
      <Button type="submit" disabled={pending}>
        {pending ? "Creating your account…" : "Create your account"}
      </Button>
    </form>
  );
}
