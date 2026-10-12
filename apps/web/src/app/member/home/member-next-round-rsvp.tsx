"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";

import { FieldHelp, FormMessage } from "@/components/blocks";
import { Button } from "@/components/ui/button";
import { setRoundRsvpAction } from "@/app/actions/rounds";
import type { MemberNextRound } from "@/domain/member-next-round";

export function MemberNextRoundRsvp({
  roundId,
  groupTimeZone,
  initialRsvpStatus,
  initialParticipantVersion,
  initialChangedAt,
}: Readonly<{
  roundId: string;
  groupTimeZone: string;
  initialRsvpStatus: MemberNextRound["participant"]["rsvpStatus"];
  initialParticipantVersion: number;
  initialChangedAt: string | null;
}>) {
  const router = useRouter();
  const operationId = useRef<string | null>(null);
  const operationStatus = useRef<"playing" | "not_playing" | null>(null);
  const [rsvpStatus, setRsvpStatus] = useState(initialRsvpStatus);
  const [participantVersion, setParticipantVersion] = useState(
    initialParticipantVersion,
  );
  const [changedAt, setChangedAt] = useState(initialChangedAt);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"error" | "success" | "">("");
  const [pendingStatus, setPendingStatus] = useState<
    "playing" | "not_playing" | null
  >(null);
  const [pending, startTransition] = useTransition();

  function changeRsvp(nextStatus: "playing" | "not_playing") {
    if (pending || nextStatus === rsvpStatus) return;
    if (operationStatus.current !== nextStatus) {
      operationId.current = crypto.randomUUID();
      operationStatus.current = nextStatus;
    } else {
      operationId.current ??= crypto.randomUUID();
    }
    setMessage("");
    setMessageTone("");
    setPendingStatus(nextStatus);
    startTransition(async () => {
      try {
        const result = await setRoundRsvpAction({
          roundId,
          rsvpStatus: nextStatus,
          expectedParticipantVersion: participantVersion,
          operationId: operationId.current,
        });
        if (!result.ok) {
          setMessage(result.error.message);
          setMessageTone("error");
          if (result.error.code === "stale_version") router.refresh();
          return;
        }
        setRsvpStatus(result.data.rsvpStatus);
        setParticipantVersion(result.data.version);
        setChangedAt(result.data.changedAt);
        operationId.current = null;
        operationStatus.current = null;
        setMessage("Response saved.");
        setMessageTone("success");
        router.refresh();
      } catch {
        setMessage("We could not save your response. Try again.");
        setMessageTone("error");
      } finally {
        setPendingStatus(null);
      }
    });
  }

  return (
    <div className="member-home-rsvp-controls">
      <FieldHelp>
        Your answer: <strong>{formatRsvp(rsvpStatus)}</strong>
        {changedAt ? (
          <span> Updated {formatRsvpChangedAt(changedAt, groupTimeZone)}</span>
        ) : null}
      </FieldHelp>
      <div
        className="mt-6 flex flex-wrap items-center gap-y-3 gap-x-5"
        aria-label="Round RSVP"
      >
        <Button
          variant={rsvpStatus === "playing" ? "default" : "outline"}
          type="button"
          aria-pressed={rsvpStatus === "playing"}
          disabled={pending}
          onClick={() => changeRsvp("playing")}
        >
          {pendingStatus === "playing" ? "Saving…" : "Playing"}
        </Button>
        <Button
          variant={rsvpStatus === "not_playing" ? "default" : "outline"}
          type="button"
          aria-pressed={rsvpStatus === "not_playing"}
          disabled={pending}
          onClick={() => changeRsvp("not_playing")}
        >
          {pendingStatus === "not_playing" ? "Saving…" : "Not playing"}
        </Button>
      </div>
      <FormMessage
        tone={messageTone === "success" ? "success" : "error"}
        aria-live="polite"
        data-status={messageTone || undefined}
      >
        {message}
      </FormMessage>
    </div>
  );
}

export function formatRsvp(
  status: MemberNextRound["participant"]["rsvpStatus"],
): string {
  if (status === "playing") return "Playing";
  if (status === "not_playing") return "Not playing";
  return "No response";
}

export function formatRsvpChangedAt(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  }).format(new Date(value));
}
