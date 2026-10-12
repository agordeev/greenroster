"use client";

import Link from "next/link";
import { useActionState, useState } from "react";

import {
  initialInvitationActionState,
  registerInvitationAction,
} from "@/app/actions/invitations";
import { Field } from "@/components/ui";
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
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          aria-describedby="registration-email-help"
          required
        />
        <p id="registration-email-help" className="field-help">
          Use the invited address or another address you can open. The
          invitation joins the account that accepts it.
        </p>
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
          name="password"
          type={showPassword ? "text" : "password"}
          autoComplete="new-password"
          aria-describedby="registration-password-help"
          required
        />
        <p id="registration-password-help" className="field-help">
          Use a passphrase of at least {MINIMUM_PASSWORD_LENGTH} characters.
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

      <p className="form-message" aria-live="polite" data-status={state.status}>
        {state.message}
      </p>

      {state.status === "success" ? (
        <Link className="primary-button button-link" href="/invitations/accept">
          Continue to invitation
        </Link>
      ) : (
        <button className="primary-button" type="submit" disabled={pending}>
          {pending ? "Creating account…" : "Create account"}
        </button>
      )}

      <Link className="secondary-link" href="/invitations/accept">
        Return to invitation
      </Link>
    </form>
  );
}
