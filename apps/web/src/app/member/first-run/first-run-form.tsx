"use client";

import Link from "next/link";
import { useActionState } from "react";

import {
  completeMemberFirstRunAction,
  initialMemberFirstRunActionState,
} from "@/app/actions/member-profile";
import { Field } from "@/components/blocks";

type MemberFirstRunFormProps = Readonly<{
  firstName: string;
  lastName: string;
  operationId: string;
  privacyVersion: string;
  termsVersion: string;
}>;

export function MemberFirstRunForm(props: MemberFirstRunFormProps) {
  const [state, formAction, pending] = useActionState(
    completeMemberFirstRunAction,
    initialMemberFirstRunActionState,
  );

  if (state.status === "success") {
    return (
      <div className="invitation-action-success" role="status">
        <p className="form-message" data-status="success">
          {state.message}
        </p>
        <Link className="primary-button button-link" href="/member/home">
          Home
        </Link>
      </div>
    );
  }

  return (
    <form action={formAction} className="auth-form" noValidate>
      <input name="operationId" type="hidden" value={props.operationId} />
      <input name="termsVersion" type="hidden" value={props.termsVersion} />
      <input name="privacyVersion" type="hidden" value={props.privacyVersion} />

      <Field id="firstName" label="First name">
        <input
          id="firstName"
          name="firstName"
          defaultValue={props.firstName}
          autoComplete="given-name"
          maxLength={100}
          required
        />
      </Field>
      <Field id="lastName" label="Last name">
        <input
          id="lastName"
          name="lastName"
          defaultValue={props.lastName}
          autoComplete="family-name"
          maxLength={100}
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
        {pending ? "Confirming…" : "Confirm profile and continue"}
      </button>
    </form>
  );
}
