"use client";

import Link from "next/link";
import { useActionState } from "react";

import {
  completeMemberFirstRunAction,
  initialMemberFirstRunActionState,
} from "@/app/actions/member-profile";
import { Field, FormMessage } from "@/components/blocks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";

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
        <FormMessage tone="success" data-status="success">
          {state.message}
        </FormMessage>
        <Button asChild>
          <Link href="/member/home">Home</Link>
        </Button>
      </div>
    );
  }

  return (
    <form action={formAction} className="auth-form" noValidate>
      <input name="operationId" type="hidden" value={props.operationId} />
      <input name="termsVersion" type="hidden" value={props.termsVersion} />
      <input name="privacyVersion" type="hidden" value={props.privacyVersion} />

      <Field id="firstName" label="First name">
        <Input
          id="firstName"
          name="firstName"
          defaultValue={props.firstName}
          autoComplete="given-name"
          maxLength={100}
          required
        />
      </Field>
      <Field id="lastName" label="Last name">
        <Input
          id="lastName"
          name="lastName"
          defaultValue={props.lastName}
          autoComplete="family-name"
          maxLength={100}
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
        {pending ? "Confirming…" : "Confirm profile and continue"}
      </Button>
    </form>
  );
}
