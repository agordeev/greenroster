"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition, type FormEvent } from "react";

import { cancelRoundAction } from "@/app/actions/rounds";
import { ChevronDownIcon } from "lucide-react";

import { Field, FormMessage } from "@/components/blocks";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
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
      setMessage("Save or discard your changes before you cancel.");
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
    <details className="group/cancel mt-10 border-y [&>summary]:flex [&>summary]:min-h-11 [&>summary]:cursor-pointer [&>summary]:list-none [&>summary]:items-center [&>summary]:justify-between [&>summary]:gap-3 [&>summary]:py-3 [&>summary]:text-[1rem] [&>summary]:font-semibold [&>summary::-webkit-details-marker]:hidden">
      <summary>
        Cancel this round
        <ChevronDownIcon
          aria-hidden="true"
          className="size-4 text-muted-foreground transition-transform group-open/cancel:rotate-180"
        />
      </summary>
      <div className="max-w-184 pb-6">
        <p className="m-0 leading-[1.55] text-muted-foreground">
          Cancelling keeps the round and its history, turns off RSVP and
          scoring, and{" "}
          {state === "draft"
            ? "sends no e-mails."
            : "e-mails every player in the round."}
        </p>
        {roundCancellationBlockedByDraftChanges(state, draftDirty) ? (
          <FormMessage role="status" className="mt-4">
            Save or discard your changes before you cancel.
          </FormMessage>
        ) : null}
        <form
          className="mt-5 gap-5 grid [:where(&)>*]:my-0"
          data-slot="form-stack"
          onSubmit={submit}
          aria-busy={pending}
          noValidate
        >
          <Field id="round-cancellation-reason" label="Reason for cancelling">
            <Textarea
              id="round-cancellation-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={500}
              rows={3}
              disabled={pending}
              required
            />
          </Field>
          {message ? (
            <FormMessage
              tone={messageTone === "success" ? "success" : "error"}
              role="status"
            >
              {message}
            </FormMessage>
          ) : null}
          <Button
            variant="destructive"
            type="submit"
            disabled={
              pending ||
              roundCancellationBlockedByDraftChanges(state, draftDirty)
            }
          >
            {pending ? "Cancelling…" : "Cancel round"}
          </Button>
        </form>
      </div>
    </details>
  );
}
