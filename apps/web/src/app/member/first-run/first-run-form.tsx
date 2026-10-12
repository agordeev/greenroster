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
      <div
        className="mt-8 gap-3 grid justify-items-start [&_[data-slot='button']]:mt-1"
        role="status"
      >
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
    <form action={formAction} className="mt-9 gap-5 grid max-w-120" noValidate>
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
        {pending ? "Confirming…" : "Confirm profile and continue"}
      </Button>
    </form>
  );
}
