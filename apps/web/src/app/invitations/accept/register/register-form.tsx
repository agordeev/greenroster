"use client";

import Link from "next/link";
import { useActionState, useState } from "react";

import { registerInvitationAction } from "@/app/actions/invitations";
import { initialInvitationActionState } from "@/app/actions/invitation-action-state";
import { Field, FieldHelp, FormMessage, TextLink } from "@/components/blocks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MINIMUM_PASSWORD_LENGTH } from "@/lib/auth/auth-validation";

export function InvitationRegisterForm() {
  const [state, formAction, pending] = useActionState(
    registerInvitationAction,
    initialInvitationActionState,
  );
  const [showPassword, setShowPassword] = useState(false);

  return (
    <form action={formAction} className="mt-9 gap-5 grid max-w-120" noValidate>
      <div
        className="gap-2 grid [&>label]:text-[0.8125rem] [&>label]:font-bold [&>label]:tracking-[0.015em] [&>span]:text-[0.8125rem] [&>span]:font-bold [&>span]:tracking-[0.015em]"
        data-slot="field"
      >
        <label htmlFor="email">Account e-mail</label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          aria-describedby="registration-email-help"
          required
        />
        <FieldHelp id="registration-email-help">
          Use the invited address or another address you can open.
        </FieldHelp>
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
          name="password"
          type={showPassword ? "text" : "password"}
          autoComplete="new-password"
          aria-describedby="registration-password-help"
          required
        />
        <FieldHelp id="registration-password-help">
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

      <FormMessage
        tone={state.status === "success" ? "success" : "error"}
        aria-live="polite"
        data-status={state.status}
      >
        {state.message}
      </FormMessage>

      {state.status === "success" ? (
        <Button asChild>
          <Link href="/invitations/accept">Continue to invitation</Link>
        </Button>
      ) : (
        <Button type="submit" disabled={pending}>
          {pending ? "Creating account…" : "Create account"}
        </Button>
      )}

      <TextLink href="/invitations/accept">Return to invitation</TextLink>
    </form>
  );
}
