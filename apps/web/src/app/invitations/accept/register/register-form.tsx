"use client";

import Link from "next/link";
import { useActionState, useState } from "react";

import {
  initialInvitationActionState,
  registerInvitationAction,
} from "@/app/actions/invitations";
import { Field, FormMessage } from "@/components/blocks";
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
    <form action={formAction} className="auth-form" noValidate>
      <div className="field-group">
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
        <p id="registration-email-help" className="field-help">
          Use the invited address or another address you can open.
        </p>
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
          name="password"
          type={showPassword ? "text" : "password"}
          autoComplete="new-password"
          aria-describedby="registration-password-help"
          required
        />
        <p id="registration-password-help" className="field-help">
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

      <Link className="secondary-link" href="/invitations/accept">
        Return to invitation
      </Link>
    </form>
  );
}
