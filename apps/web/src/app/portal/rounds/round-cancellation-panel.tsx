"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition, type FormEvent } from "react";

import { cancelRoundAction } from "@/app/actions/rounds";
import { SectionHeading } from "@/components/ui";
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
      setMessage("Save or discard your draft changes before you cancel.");
      setMessageTone("error");
      return;
    }
    const notificationSummary =
      state === "draft" ? "No one is notified." : "Players will be notified.";
    if (
      !window.confirm(
        `Cancel “${description}”? RSVP and scoring will be turned off. ${notificationSummary}`,
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
        setMessage("We couldn't cancel the round. Try again.");
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
        `Round cancelled. ${result.data.notificationCount} e-mail${result.data.notificationCount === 1 ? "" : "s"} will be sent to players.`,
      );
      setMessageTone("success");
      router.refresh();
    });
  }

  return (
    <section className="page-section" aria-labelledby="cancel-round-title">
      <SectionHeading
        kicker="Cancellation"
        title={<>Cancel this {state} round</>}
        titleId="cancel-round-title"
        meta={
          state === "draft" ? "Draft" : state === "live" ? "Live" : "Published"
        }
      />
      <p>
        Cancelling keeps the round and its history, turns off RSVP and scoring,
        and{" "}
        {state === "draft"
          ? "sends no e-mails."
          : "e-mails every player in the round."}
      </p>
      {roundCancellationBlockedByDraftChanges(state, draftDirty) ? (
        <p className="form-message error" role="status">
          Save or discard your draft changes before you cancel.
        </p>
      ) : null}
      <form
        className="form-stack"
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
          <small id="round-cancellation-help">Required.</small>
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
