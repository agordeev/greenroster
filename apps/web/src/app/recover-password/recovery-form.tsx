"use client";

import { useActionState, useEffect, useRef } from "react";

import { requestPasswordResetAction } from "@/app/actions/auth";
import { initialAuthFormState } from "@/app/actions/auth-state";
import { FieldError, FormMessage, TextLink } from "@/components/blocks";
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
    <form action={formAction} className="mt-9 gap-5 grid max-w-120" noValidate>
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
            state.fieldErrors?.email ? "recovery-email-error" : undefined
          }
          required
        />
        {state.fieldErrors?.email ? (
          <FieldError id="recovery-email-error">
            Enter a valid account e-mail.
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
      <Button type="submit" disabled={pending}>
        {pending ? "Sending…" : "Send recovery link"}
      </Button>
      <TextLink href="/sign-in">Return to sign in</TextLink>
    </form>
  );
}
