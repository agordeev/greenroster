"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useRef, useState, useTransition } from "react";

import { bootstrapGroupAction } from "@/app/actions/groups";
import { resolveBootstrapOperationId } from "@/lib/groups/bootstrap-operation";

type FormErrors = Readonly<{
  groupName?: string;
  groupTimeZone?: string;
}>;

export function GroupBootstrapForm({
  identityKey,
}: Readonly<{ identityKey: string }>) {
  const router = useRouter();
  const operationId = useRef<string | null>(null);
  const storageKey = `greenroster:group-bootstrap:${identityKey}`;
  const nameRef = useRef<HTMLInputElement>(null);
  const timeZoneRef = useRef<HTMLInputElement>(null);
  const [groupName, setGroupName] = useState("");
  const [groupTimeZone, setGroupTimeZone] = useState("");
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
        // In-memory retry remains available when browser storage is blocked.
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

      let result: Awaited<ReturnType<typeof bootstrapGroupAction>>;

      try {
        result = await bootstrapGroupAction({
          groupName,
          groupTimeZone,
          operationId: operationId.current,
        });
      } catch {
        setMessage("The service is temporarily unavailable. Try again.");
        return;
      }

      if (result.ok) {
        router.refresh();
        return;
      }

      if (result.error.code === "authentication_required") {
        router.replace("/sign-in?status=session-expired");
        return;
      }

      const nextErrors = {
        ...(result.error.fieldErrors?.groupName
          ? { groupName: "Enter a group name." }
          : {}),
        ...(result.error.fieldErrors?.groupTimeZone
          ? { groupTimeZone: "Enter a supported IANA time zone." }
          : {}),
      };

      setErrors(nextErrors);
      setMessage(result.error.message);

      if (nextErrors.groupName) nameRef.current?.focus();
      else if (nextErrors.groupTimeZone) timeZoneRef.current?.focus();
    });
  }

  return (
    <form
      className="bootstrap-form"
      onSubmit={submit}
      aria-busy={pending}
      noValidate
    >
      <div className="field-group">
        <label htmlFor="groupName">Group name</label>
        <input
          id="groupName"
          ref={nameRef}
          name="groupName"
          value={groupName}
          onChange={(event) => setGroupName(event.target.value)}
          autoComplete="organization"
          aria-invalid={Boolean(errors.groupName)}
          aria-describedby={errors.groupName ? "group-name-error" : undefined}
          required
        />
        {errors.groupName ? (
          <p id="group-name-error" className="field-error">
            {errors.groupName}
          </p>
        ) : null}
      </div>

      <div className="field-group">
        <label htmlFor="groupTimeZone">Group time zone</label>
        <input
          id="groupTimeZone"
          ref={timeZoneRef}
          name="groupTimeZone"
          value={groupTimeZone}
          onChange={(event) => setGroupTimeZone(event.target.value)}
          placeholder="America/New_York"
          autoComplete="off"
          aria-invalid={Boolean(errors.groupTimeZone)}
          aria-describedby={
            errors.groupTimeZone
              ? "group-time-zone-help group-time-zone-error"
              : "group-time-zone-help"
          }
          required
        />
        <p id="group-time-zone-help" className="field-help">
          Round times and reminders use this IANA time zone.
        </p>
        {errors.groupTimeZone ? (
          <p id="group-time-zone-error" className="field-error">
            {errors.groupTimeZone}
          </p>
        ) : null}
      </div>

      <p className="form-message" aria-live="polite" data-status="error">
        {message}
      </p>
      <button className="primary-button" type="submit" disabled={pending}>
        {pending ? "Creating group…" : "Create group and continue"}
      </button>
    </form>
  );
}
