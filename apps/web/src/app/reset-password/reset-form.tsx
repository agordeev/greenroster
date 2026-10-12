"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";

import { updatePasswordAction } from "@/app/actions/auth";
import { initialAuthFormState } from "@/app/actions/auth-state";
import { FieldError, FormMessage } from "@/components/blocks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
    <form action={formAction} className="mt-9 gap-5 grid max-w-120" noValidate>
      <div
        className="gap-2 grid [&>label]:text-[0.8125rem] [&>label]:font-bold [&>label]:tracking-[0.015em] [&>span]:text-[0.8125rem] [&>span]:font-bold [&>span]:tracking-[0.015em]"
        data-slot="field"
      >
        <div className="flex items-baseline justify-between">
          <label htmlFor="password">New password</label>
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
          aria-invalid={Boolean(state.fieldErrors?.password)}
          aria-describedby={
            state.fieldErrors?.password ? "new-password-error" : undefined
          }
          required
        />
        {state.fieldErrors?.password ? (
          <FieldError id="new-password-error">
            Use at least {MINIMUM_PASSWORD_LENGTH} characters.
          </FieldError>
        ) : null}
      </div>
      <div
        className="gap-2 grid [&>label]:text-[0.8125rem] [&>label]:font-bold [&>label]:tracking-[0.015em] [&>span]:text-[0.8125rem] [&>span]:font-bold [&>span]:tracking-[0.015em]"
        data-slot="field"
      >
        <label htmlFor="confirmPassword">Confirm new password</label>
        <Input
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
          <FieldError id="confirm-password-error">
            Passwords must match.
          </FieldError>
        ) : null}
      </div>
      <FormMessage
        tone={state.status === "success" ? "success" : "error"}
        aria-live="polite"
        data-status={state.status}
      >
        {state.message}
      </FormMessage>
      {state.status === "success" ? (
        <Button asChild>
          <Link href="/sign-in">Return to sign in</Link>
        </Button>
      ) : (
        <Button type="submit" disabled={pending}>
          {pending ? "Updating…" : "Update password"}
        </Button>
      )}
    </form>
  );
}
