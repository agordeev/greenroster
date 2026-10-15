"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useRef, useState, useTransition } from "react";

import { FieldError, FormMessage } from "@/components/blocks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { bootstrapGroupAction } from "@/app/actions/groups";
import { resolveBootstrapOperationId } from "@/lib/groups/bootstrap-operation";
import { useLocalTimeZone } from "@/lib/local-time-zone";

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
  const localTimeZone = useLocalTimeZone();
  const [editedTimeZone, setGroupTimeZone] = useState<string | null>(null);
  const groupTimeZone = editedTimeZone ?? localTimeZone;
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
        setMessage("We couldn't create your group. Try again.");
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
          ? { groupTimeZone: "Enter a valid time zone, such as Europe/London." }
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
      className="mt-8 gap-5 grid max-w-120"
      onSubmit={submit}
      aria-busy={pending}
      noValidate
    >
      <div
        className="gap-2 grid [&>label]:text-[0.8125rem] [&>label]:font-bold [&>label]:tracking-[0.015em] [&>span]:text-[0.8125rem] [&>span]:font-bold [&>span]:tracking-[0.015em]"
        data-slot="field"
      >
        <label htmlFor="groupName">Group name</label>
        <Input
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
          <FieldError id="group-name-error">{errors.groupName}</FieldError>
        ) : null}
      </div>

      <div
        className="gap-2 grid [&>label]:text-[0.8125rem] [&>label]:font-bold [&>label]:tracking-[0.015em] [&>span]:text-[0.8125rem] [&>span]:font-bold [&>span]:tracking-[0.015em]"
        data-slot="field"
      >
        <label htmlFor="groupTimeZone">Group time zone</label>
        <Input
          id="groupTimeZone"
          ref={timeZoneRef}
          name="groupTimeZone"
          value={groupTimeZone}
          onChange={(event) => setGroupTimeZone(event.target.value)}
          placeholder="Your local time zone"
          autoComplete="off"
          aria-invalid={Boolean(errors.groupTimeZone)}
          aria-describedby={
            errors.groupTimeZone
              ? "group-time-zone-help group-time-zone-error"
              : "group-time-zone-help"
          }
          required
        />
        {errors.groupTimeZone ? (
          <FieldError id="group-time-zone-error">
            {errors.groupTimeZone}
          </FieldError>
        ) : null}
      </div>

      <FormMessage aria-live="polite" data-status="error">
        {message}
      </FormMessage>
      <Button type="submit" disabled={pending}>
        {pending ? "Creating group…" : "Create group and continue"}
      </Button>
    </form>
  );
}
