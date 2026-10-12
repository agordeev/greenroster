"use client";

import { useRouter } from "next/navigation";
import {
  useEffect,
  useRef,
  useState,
  useTransition,
  type FormEvent,
} from "react";

import { updateGroupProfileAction } from "@/app/actions/groups";
import { ActionRow } from "@/components/ui";
import { isSupportedTimeZone } from "@/lib/groups/group-profile";

export type GroupProfileFormValue = Readonly<{
  groupId: string;
  groupName: string;
  groupTimeZone: string;
  groupVersion: number;
}>;

type StoredOperation = Readonly<{
  operationId: string;
  payload: string;
}>;

type FormField = "groupName" | "groupTimeZone" | "reason";
type FormErrors = Partial<Record<FormField | "expectedGroupVersion", string>>;

export function GroupProfileForm({
  identityKey,
  initialValue,
}: Readonly<{
  identityKey: string;
  initialValue: GroupProfileFormValue;
}>) {
  const router = useRouter();
  const operationId = useRef<string | null>(null);
  const operationPayload = useRef<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const timeZoneRef = useRef<HTMLInputElement>(null);
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const storageKey = `greenroster:group-profile:${identityKey}`;
  const [groupName, setGroupName] = useState(initialValue.groupName);
  const [groupTimeZone, setGroupTimeZone] = useState(
    initialValue.groupTimeZone,
  );
  const [groupVersion, setGroupVersion] = useState(initialValue.groupVersion);
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"error" | "success" | "">("");
  const [fieldErrors, setFieldErrors] = useState<FormErrors>({});
  const focusField = useRef<FormField | null>(null);
  const [focusToken, setFocusToken] = useState(0);
  const [pending, startTransition] = useTransition();
  const dirty =
    groupName.trim() !== initialValue.groupName ||
    groupTimeZone.trim() !== initialValue.groupTimeZone;

  useEffect(() => {
    if (!dirty) return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [dirty]);

  useEffect(() => {
    if (pending || !focusField.current) return;
    if (focusField.current === "groupName") nameRef.current?.focus();
    else if (focusField.current === "groupTimeZone")
      timeZoneRef.current?.focus();
    else reasonRef.current?.focus();
    focusField.current = null;
  }, [focusToken, pending]);

  function requestFocus(field: FormField) {
    focusField.current = field;
    setFocusToken((token) => token + 1);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setMessageTone("");
    setFieldErrors({});

    const normalizedName = groupName.trim();
    const normalizedTimeZone = groupTimeZone.trim();
    const normalizedReason = reason.trim();
    if (!normalizedName) {
      setFieldErrors({ groupName: "Enter a group name." });
      requestFocus("groupName");
      setMessage("Enter a group name.");
      setMessageTone("error");
      return;
    }
    if (!isSupportedTimeZone(normalizedTimeZone)) {
      setFieldErrors({
        groupTimeZone: "Enter a time zone such as America/New_York.",
      });
      requestFocus("groupTimeZone");
      setMessage("Enter a time zone such as America/New_York.");
      setMessageTone("error");
      return;
    }
    if (!dirty) {
      setMessage("Change the group name or time zone before you save.");
      setMessageTone("error");
      return;
    }
    if (!normalizedReason) {
      setFieldErrors({
        reason: "Add a reason for this change.",
      });
      requestFocus("reason");
      setMessage("Add a reason for this change.");
      setMessageTone("error");
      return;
    }

    const payload = {
      expectedGroupVersion: groupVersion,
      groupName: normalizedName,
      groupTimeZone: normalizedTimeZone,
      reason: normalizedReason,
    };
    const serializedPayload = JSON.stringify(payload);
    if (operationPayload.current !== serializedPayload) {
      const storedOperation = readStoredOperation(storageKey);
      operationId.current =
        storedOperation?.payload === serializedPayload &&
        isUuid(storedOperation.operationId)
          ? storedOperation.operationId
          : crypto.randomUUID();
      operationPayload.current = serializedPayload;
      writeStoredOperation(storageKey, {
        operationId: operationId.current,
        payload: serializedPayload,
      });
    }

    startTransition(async () => {
      let result: Awaited<ReturnType<typeof updateGroupProfileAction>>;
      try {
        result = await updateGroupProfileAction({
          ...payload,
          operationId: operationId.current,
        });
      } catch {
        setMessage("We couldn't save this right now. Try again in a moment.");
        setMessageTone("error");
        return;
      }

      if (!result.ok) {
        setMessage(result.error.message);
        setMessageTone("error");
        const nextErrors = fieldErrorsFromResult(result.error.fieldErrors);
        setFieldErrors(nextErrors);
        const firstField = firstFieldWithError(nextErrors);
        if (firstField) requestFocus(firstField);
        if (result.error.code === "stale_version") {
          operationId.current = null;
          operationPayload.current = null;
          router.refresh();
        }
        return;
      }

      operationId.current = null;
      operationPayload.current = null;
      removeStoredOperation(storageKey);
      setGroupName(result.data.groupName);
      setGroupTimeZone(result.data.groupTimeZone);
      setGroupVersion(result.data.groupVersion);
      setReason("");
      setMessage("Group details saved.");
      setMessageTone("success");
      setFieldErrors({});
      router.refresh();
    });
  }

  function cancel() {
    if (
      dirty &&
      !window.confirm("Discard unsaved changes to the group details?")
    ) {
      return;
    }
    setGroupName(initialValue.groupName);
    setGroupTimeZone(initialValue.groupTimeZone);
    setGroupVersion(initialValue.groupVersion);
    setReason("");
    setMessage("");
    setMessageTone("");
    setFieldErrors({});
    focusField.current = null;
    operationId.current = null;
    operationPayload.current = null;
    removeStoredOperation(storageKey);
  }

  return (
    <form
      className="form-stack"
      onSubmit={submit}
      aria-busy={pending}
      noValidate
    >
      <div className="form-row">
        <div className="field-group">
          <label htmlFor="group-profile-name">Group name</label>
          <input
            id="group-profile-name"
            ref={nameRef}
            name="groupName"
            value={groupName}
            onChange={(event) => {
              setGroupName(event.target.value);
              setFieldErrors((current) => omitFieldError(current, "groupName"));
            }}
            autoComplete="organization"
            aria-invalid={Boolean(fieldErrors.groupName)}
            aria-describedby={
              fieldErrors.groupName ? "group-profile-name-error" : undefined
            }
            required
            disabled={pending}
          />
          {fieldErrors.groupName ? (
            <p id="group-profile-name-error" className="field-error">
              {fieldErrors.groupName}
            </p>
          ) : null}
        </div>
        <div className="field-group">
          <label htmlFor="group-profile-time-zone">Group time zone</label>
          <input
            id="group-profile-time-zone"
            ref={timeZoneRef}
            name="groupTimeZone"
            value={groupTimeZone}
            onChange={(event) => {
              setGroupTimeZone(event.target.value);
              setFieldErrors((current) =>
                omitFieldError(current, "groupTimeZone"),
              );
            }}
            placeholder="America/New_York"
            aria-invalid={Boolean(fieldErrors.groupTimeZone)}
            aria-describedby={
              fieldErrors.groupTimeZone
                ? "group-profile-time-zone-error"
                : undefined
            }
            required
            disabled={pending}
          />
          {fieldErrors.groupTimeZone ? (
            <p id="group-profile-time-zone-error" className="field-error">
              {fieldErrors.groupTimeZone}
            </p>
          ) : null}
        </div>
      </div>
      <div className="field-group">
        <label htmlFor="group-profile-reason">Reason for change</label>
        <textarea
          id="group-profile-reason"
          ref={reasonRef}
          name="reason"
          value={reason}
          onChange={(event) => {
            setReason(event.target.value);
            setFieldErrors((current) => omitFieldError(current, "reason"));
          }}
          maxLength={500}
          rows={3}
          aria-invalid={Boolean(fieldErrors.reason)}
          aria-describedby={
            fieldErrors.reason ? "group-profile-reason-error" : undefined
          }
          required
          disabled={pending}
        />
        {fieldErrors.reason ? (
          <p id="group-profile-reason-error" className="field-error">
            {fieldErrors.reason}
          </p>
        ) : null}
      </div>
      <p
        className="form-message"
        aria-live="polite"
        data-status={messageTone || undefined}
      >
        {message}
      </p>
      <ActionRow>
        <button className="primary-button" type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save group details"}
        </button>
        <button
          className="secondary-button"
          type="button"
          onClick={cancel}
          disabled={pending || !dirty}
        >
          Cancel
        </button>
      </ActionRow>
    </form>
  );
}

function fieldErrorsFromResult(
  errors: Readonly<Record<string, readonly string[]>> | undefined,
): FormErrors {
  if (!errors) return {};
  const next: FormErrors = {};
  for (const field of ["groupName", "groupTimeZone", "reason"] as const) {
    const message = errors[field]?.[0];
    if (message) next[field] = message;
  }
  return next;
}

function firstFieldWithError(errors: FormErrors): FormField | null {
  if (errors.groupName) return "groupName";
  if (errors.groupTimeZone) return "groupTimeZone";
  if (errors.reason) return "reason";
  return null;
}

function omitFieldError(errors: FormErrors, field: FormField): FormErrors {
  const next = { ...errors };
  delete next[field];
  return next;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
    value,
  );
}

function readStoredOperation(key: string): StoredOperation | null {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? "null");
    if (
      value &&
      typeof value === "object" &&
      "operationId" in value &&
      "payload" in value &&
      typeof value.operationId === "string" &&
      typeof value.payload === "string"
    ) {
      return value as StoredOperation;
    }
  } catch {
    // Retry with a new operation when browser storage is unavailable.
  }
  return null;
}

function writeStoredOperation(key: string, value: StoredOperation) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // The mounted form still retains the operation context in memory.
  }
}

function removeStoredOperation(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
    // Storage cleanup is best effort after a committed mutation.
  }
}
