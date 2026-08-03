"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition, type FormEvent } from "react";

import { cancelRoundAction } from "@/app/actions/rounds";
import { roundCancellationBlockedByDraftChanges } from "@/domain/round-cancellation";

export function RoundCancellationPanel({
  roundId,
  description,
  state,
  version,
  draftDirty,
}: Readonly<{
  roundId: string;
  description: string;
  state: "draft" | "published" | "live";
  version: number;
  draftDirty: boolean;
}>) {
  const router = useRouter();
  const operationId = useRef<string | null>(null);
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"error" | "success" | "">("");
  const [pending, startTransition] = useTransition();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setMessageTone("");
    const normalizedReason = reason.trim();
    if (!normalizedReason) {
      setMessage("Add a reason before cancelling this round.");
      setMessageTone("error");
      return;
    }
    if (roundCancellationBlockedByDraftChanges(state, draftDirty)) {
      setMessage("Save or discard draft changes before cancelling this round.");
      setMessageTone("error");
      return;
    }
    const notificationSummary =
      state === "draft"
        ? "No participant notification will be queued because this round has not been published."
        : "Participants will be notified.";
    if (
      !window.confirm(
        `Cancel “${description}”? RSVP and scoring will be disabled. ${notificationSummary}`,
      )
    ) {
      return;
    }

    operationId.current ??= crypto.randomUUID();
    startTransition(async () => {
      let result: Awaited<ReturnType<typeof cancelRoundAction>>;
      try {
        result = await cancelRoundAction({
          roundId,
          reason: normalizedReason,
          expectedRoundVersion: version,
          operationId: operationId.current,
        });
      } catch {
        setMessage("The round service is temporarily unavailable. Try again.");
        setMessageTone("error");
        return;
      }

      if (!result.ok) {
        setMessage(result.error.message);
        setMessageTone("error");
        if (
          result.error.code === "stale_version" ||
          result.error.code === "locked"
        ) {
          operationId.current = null;
          router.refresh();
        }
        return;
      }

      operationId.current = null;
      setReason("");
      setMessage(
        `Round cancelled. ${result.data.notificationCount} participant notification${result.data.notificationCount === 1 ? "" : "s"} queued.`,
      );
      setMessageTone("success");
      router.refresh();
    });
  }

  return (
    <section className="group-roles-panel" aria-labelledby="cancel-round-title">
      <div className="group-panel-heading">
        <div>
          <p className="ledger-kicker">Round lifecycle</p>
          <h2 id="cancel-round-title">Cancel this {state} round</h2>
        </div>
        <p>Version {version}</p>
      </div>
      <p>
        Cancellation preserves the round and participant history, disables RSVP
        and scoring, and{" "}
        {state === "draft"
          ? "does not queue participant notifications before publication."
          : "sends a mandatory e-mail to the published participants."}
      </p>
      {roundCancellationBlockedByDraftChanges(state, draftDirty) ? (
        <p className="form-message error" role="status">
          Save or discard draft changes before cancelling this round.
        </p>
      ) : null}
      <form
        className="group-profile-form"
        onSubmit={submit}
        aria-busy={pending}
        noValidate
      >
        <label className="field-group" htmlFor="round-cancellation-reason">
          <span>Reason</span>
          <textarea
            id="round-cancellation-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            maxLength={500}
            rows={3}
            disabled={pending}
            aria-describedby="round-cancellation-help"
          />
          <small id="round-cancellation-help">
            Required and retained with the cancelled round (500 characters
            maximum).
          </small>
        </label>
        {message ? (
          <p className={`form-message ${messageTone}`} role="status">
            {message}
          </p>
        ) : null}
        <button
          className="danger-button"
          type="submit"
          disabled={
            pending || roundCancellationBlockedByDraftChanges(state, draftDirty)
          }
        >
          {pending ? "Cancelling…" : "Cancel round"}
        </button>
      </form>
    </section>
  );
}
