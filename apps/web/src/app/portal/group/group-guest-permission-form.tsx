"use client";

import { useRouter } from "next/navigation";
import {
  useEffect,
  useRef,
  useState,
  useTransition,
  type FormEvent,
} from "react";

import { updateGroupGuestPermissionAction } from "@/app/actions/groups";

export type GroupGuestPermissionFormValue = Readonly<{
  allowMemberGuests: boolean;
  groupVersion: number;
}>;

export function GroupGuestPermissionForm({
  initialValue,
}: Readonly<{
  initialValue: GroupGuestPermissionFormValue;
}>) {
  const router = useRouter();
  const operationId = useRef<string | null>(null);
  const operationPayload = useRef<string | null>(null);
  const [allowMemberGuests, setAllowMemberGuests] = useState(
    initialValue.allowMemberGuests,
  );
  const [groupVersion, setGroupVersion] = useState(initialValue.groupVersion);
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"error" | "success" | "">("");
  const [pending, startTransition] = useTransition();
  const policyChanged = allowMemberGuests !== initialValue.allowMemberGuests;
  const dirty = policyChanged || reason.trim() !== "";

  useEffect(() => {
    if (!dirty) return;

    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [dirty]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setMessageTone("");

    if (!policyChanged) {
      setMessage("There are no guest-permission changes to save.");
      setMessageTone("error");
      return;
    }
    const normalizedReason = reason.trim();
    if (!normalizedReason) {
      setMessage("Add a reason for this guest-permission change.");
      setMessageTone("error");
      return;
    }

    const payload = JSON.stringify({
      allowMemberGuests,
      expectedGroupVersion: groupVersion,
      reason: normalizedReason,
    });
    if (operationPayload.current !== payload) {
      operationId.current = crypto.randomUUID();
      operationPayload.current = payload;
    }

    startTransition(async () => {
      try {
        const result = await updateGroupGuestPermissionAction({
          allowMemberGuests,
          expectedGroupVersion: groupVersion,
          operationId: operationId.current,
          reason: normalizedReason,
        });
        if (!result.ok) {
          setMessage(result.error.message);
          setMessageTone("error");
          if (result.error.code === "stale_version") {
            operationId.current = null;
            operationPayload.current = null;
            router.refresh();
          }
          return;
        }
        operationId.current = null;
        operationPayload.current = null;
        setAllowMemberGuests(result.data.allowMemberGuests);
        setGroupVersion(result.data.groupVersion);
        setReason("");
        setMessage("Guest permission saved.");
        setMessageTone("success");
        router.refresh();
      } catch {
        setMessage("The guest-permission service is temporarily unavailable.");
        setMessageTone("error");
      }
    });
  }

  function cancel() {
    if (dirty && !window.confirm("Discard unsaved guest-permission changes?")) {
      return;
    }
    setAllowMemberGuests(initialValue.allowMemberGuests);
    setGroupVersion(initialValue.groupVersion);
    setReason("");
    setMessage("");
    setMessageTone("");
    operationId.current = null;
    operationPayload.current = null;
  }

  return (
    <form
      className="group-profile-form group-guest-permission-form"
      onSubmit={submit}
      aria-busy={pending}
      noValidate
    >
      <label className="checkbox-field">
        <input
          type="checkbox"
          checked={allowMemberGuests}
          onChange={(event) => setAllowMemberGuests(event.target.checked)}
          disabled={pending}
        />
        <span>Allow active Playing members to add round-scoped guests</span>
      </label>
      <p className="field-help">
        Guests have no account or contact data, receive no notifications, and
        never enter permanent membership or standings totals.
      </p>
      <label htmlFor="guest-permission-reason">Reason for change</label>
      <textarea
        id="guest-permission-reason"
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        maxLength={500}
        rows={3}
        required
        disabled={pending}
      />
      <p
        className="form-message"
        aria-live="polite"
        data-status={messageTone || undefined}
      >
        {message}
      </p>
      <div className="information-actions">
        <button className="primary-button" type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save guest permission"}
        </button>
        <button
          className="secondary-button"
          type="button"
          onClick={cancel}
          disabled={pending || !dirty}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
