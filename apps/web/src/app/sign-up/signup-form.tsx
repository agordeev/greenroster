"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";

import { initialAuthFormState } from "@/app/actions/auth-state";
import { registerOrganizerAction } from "@/app/actions/auth";
import { Field, FieldError, FieldHelp, FormMessage } from "@/components/blocks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { MINIMUM_PASSWORD_LENGTH } from "@/lib/auth/auth-validation";

export function OrganizerSignupForm({
  source,
}: Readonly<{ source: string | null }>) {
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
      <div
        className="mt-8 gap-3 grid justify-items-start [&_[data-slot='button']]:mt-1"
        role="status"
      >
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
    <form action={formAction} className="mt-9 gap-5 grid max-w-120" noValidate>
      {source ? <input type="hidden" name="source" value={source} /> : null}
      <div
        className="gap-2 grid [&>label]:text-[0.8125rem] [&>label]:font-bold [&>label]:tracking-[0.015em] [&>span]:text-[0.8125rem] [&>span]:font-bold [&>span]:tracking-[0.015em]"
        data-slot="field"
      >
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
          <FieldError id="email-error">
            Enter a valid account e-mail.
          </FieldError>
        ) : null}
      </div>

      <div
        className="gap-2 grid [&>label]:text-[0.8125rem] [&>label]:font-bold [&>label]:tracking-[0.015em] [&>span]:text-[0.8125rem] [&>span]:font-bold [&>span]:tracking-[0.015em]"
        data-slot="field"
      >
        <div className="flex items-baseline justify-between">
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
        <FieldHelp id="password-help">
          Use a password of at least {MINIMUM_PASSWORD_LENGTH} characters.
        </FieldHelp>
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

      <label className="gap-2 flex items-start text-muted-foreground text-[0.8125rem] font-normal leading-[1.45] [&_a]:text-primary [&_a]:font-bold [&_a]:underline [&_a]:underline-offset-[0.2em]">
        <Checkbox name="acceptedTerms" required />
        <span>
          I accept the current <Link href="/terms">Terms of Use</Link>.
        </span>
      </label>
      <label className="gap-2 flex items-start text-muted-foreground text-[0.8125rem] font-normal leading-[1.45] [&_a]:text-primary [&_a]:font-bold [&_a]:underline [&_a]:underline-offset-[0.2em]">
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
