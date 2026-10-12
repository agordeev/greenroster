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
import { ActionRow, FormMessage } from "@/components/blocks";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";

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
      setMessage("Change the guest setting before you save.");
      setMessageTone("error");
      return;
    }
    const normalizedReason = reason.trim();
    if (!normalizedReason) {
      setMessage("Add a reason for this change.");
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
        setMessage("Guest setting saved.");
        setMessageTone("success");
        router.refresh();
      } catch {
        setMessage("We couldn't save this right now. Try again in a moment.");
        setMessageTone("error");
      }
    });
  }

  function cancel() {
    if (
      dirty &&
      !window.confirm("Discard unsaved changes to the guest setting?")
    ) {
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
      className="form-stack group-guest-permission-form"
      onSubmit={submit}
      aria-busy={pending}
      noValidate
    >
      <label className="checkbox-field">
        <Checkbox
          checked={allowMemberGuests}
          onCheckedChange={(checked) => setAllowMemberGuests(checked === true)}
          disabled={pending}
        />
        <span>Let members who are playing bring guests</span>
      </label>
      <p className="field-help">
        Guests don&apos;t need an account and don&apos;t appear in standings.
      </p>
      <label htmlFor="guest-permission-reason">Reason for change</label>
      <Textarea
        id="guest-permission-reason"
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        maxLength={500}
        rows={3}
        required
        disabled={pending}
      />
      <FormMessage
        tone={messageTone === "success" ? "success" : "error"}
        aria-live="polite"
        data-status={messageTone || undefined}
      >
        {message}
      </FormMessage>
      <ActionRow>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save guest setting"}
        </Button>
        <Button
          variant="outline"
          type="button"
          onClick={cancel}
          disabled={pending || !dirty}
        >
          Cancel
        </Button>
      </ActionRow>
    </form>
  );
}
