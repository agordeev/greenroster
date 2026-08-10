"use client";

import Link from "next/link";
import { FormEvent, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { bootstrapOrganizerAction } from "@/app/actions/auth";
import { resolveBootstrapOperationId } from "@/lib/groups/bootstrap-operation";

type OrganizerBootstrapFormProps = Readonly<{
  identityKey: string;
  operationId: string;
  legalAccepted: boolean;
  termsVersion: string;
  privacyVersion: string;
}>;

type FormErrors = Readonly<{
  firstName?: string;
  lastName?: string;
  groupName?: string;
  groupTimeZone?: string;
}>;

export function OrganizerBootstrapForm({
  identityKey,
  operationId: initialOperationId,
  legalAccepted,
  termsVersion,
  privacyVersion,
}: OrganizerBootstrapFormProps) {
  const router = useRouter();
  const storageKey = `greenroster:organizer-bootstrap:${identityKey}`;
  const operationId = useRef<string | null>(initialOperationId);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [groupName, setGroupName] = useState("");
  const [groupTimeZone, setGroupTimeZone] = useState("");
  const [acceptedTerms, setAcceptedTerms] = useState(legalAccepted);
  const [acceptedPrivacy, setAcceptedPrivacy] = useState(legalAccepted);
  const [message, setMessage] = useState("");
  const [errors, setErrors] = useState<FormErrors>({});
  const [pending, startTransition] = useTransition();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setErrors({});

    startTransition(async () => {
      let storedOperationId: string | null = null;
      try {
        storedOperationId = localStorage.getItem(storageKey);
      } catch {
        // The mounted form still keeps the operation identifier.
      }
      operationId.current = resolveBootstrapOperationId(
        operationId.current ?? storedOperationId,
        () => crypto.randomUUID(),
      );
      try {
        localStorage.setItem(storageKey, operationId.current);
      } catch {
        // The current mounted form still keeps the operation identifier.
      }

      let result: Awaited<ReturnType<typeof bootstrapOrganizerAction>>;
      try {
        result = await bootstrapOrganizerAction({
          firstName,
          lastName,
          groupName,
          groupTimeZone,
          acceptedTerms,
          acceptedPrivacy,
          operationId: operationId.current,
        });
      } catch {
        setMessage(
          "The sign-up service could not be reached. Try again in a moment.",
        );
        return;
      }

      if (result.ok) {
        router.replace("/portal");
        return;
      }
      if (result.error.code === "authentication_required") {
        router.replace("/sign-in?status=session-expired");
        return;
      }

      const nextErrors = {
        ...(result.error.fieldErrors?.firstName
          ? { firstName: "Enter your first name." }
          : {}),
        ...(result.error.fieldErrors?.lastName
          ? { lastName: "Enter your last name." }
          : {}),
        ...(result.error.fieldErrors?.groupName
          ? { groupName: "Enter a group name." }
          : {}),
        ...(result.error.fieldErrors?.groupTimeZone
          ? { groupTimeZone: "Enter a supported IANA time zone." }
          : {}),
      };
      setErrors(nextErrors);
      setMessage(result.error.message);
    });
  }

  return (
    <form
      className="auth-form"
      onSubmit={submit}
      aria-busy={pending}
      noValidate
    >
      <div className="field-group">
        <label htmlFor="firstName">First name</label>
        <input
          id="firstName"
          name="firstName"
          value={firstName}
          onChange={(event) => setFirstName(event.target.value)}
          autoComplete="given-name"
          required
        />
        {errors.firstName ? (
          <p className="field-error">{errors.firstName}</p>
        ) : null}
      </div>
      <div className="field-group">
        <label htmlFor="lastName">Last name</label>
        <input
          id="lastName"
          name="lastName"
          value={lastName}
          onChange={(event) => setLastName(event.target.value)}
          autoComplete="family-name"
          required
        />
        {errors.lastName ? (
          <p className="field-error">{errors.lastName}</p>
        ) : null}
      </div>
      <div className="field-group">
        <label htmlFor="groupName">Group name</label>
        <input
          id="groupName"
          name="groupName"
          value={groupName}
          onChange={(event) => setGroupName(event.target.value)}
          autoComplete="organization"
          required
        />
        {errors.groupName ? (
          <p className="field-error">{errors.groupName}</p>
        ) : null}
      </div>
      <div className="field-group">
        <label htmlFor="groupTimeZone">Group time zone</label>
        <input
          id="groupTimeZone"
          name="groupTimeZone"
          value={groupTimeZone}
          onChange={(event) => setGroupTimeZone(event.target.value)}
          placeholder="America/New_York"
          required
        />
        <p className="field-help">
          Round times and reminders use this IANA time zone.
        </p>
        {errors.groupTimeZone ? (
          <p className="field-error">{errors.groupTimeZone}</p>
        ) : null}
      </div>
      <label className="confirmation-row">
        <input
          name="acceptedTerms"
          type="checkbox"
          checked={acceptedTerms}
          onChange={(event) => setAcceptedTerms(event.target.checked)}
          required
        />
        <span>
          You accept the current <Link href="/terms">Terms of Use</Link>{" "}
          (version {termsVersion}).
        </span>
      </label>
      <label className="confirmation-row">
        <input
          name="acceptedPrivacy"
          type="checkbox"
          checked={acceptedPrivacy}
          onChange={(event) => setAcceptedPrivacy(event.target.checked)}
          required
        />
        <span>
          You accept the current <Link href="/privacy">Privacy Policy</Link>{" "}
          (version {privacyVersion}).
        </span>
      </label>
      <p className="form-message" aria-live="polite" data-status="error">
        {message}
      </p>
      <button className="primary-button" type="submit" disabled={pending}>
        {pending ? "Creating your group…" : "Create your group and continue"}
      </button>
    </form>
  );
}
