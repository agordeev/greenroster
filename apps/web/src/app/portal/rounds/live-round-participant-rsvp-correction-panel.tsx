"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition, type FormEvent } from "react";

import { setLiveRoundParticipantNotPlayingAction } from "@/app/actions/rounds";
import { liveRoundParticipantNotPlayingInputSchema } from "@/domain/live-round-participant-rsvp-correction";
import type { LiveRoundScoreParticipant } from "@/domain/round-score";

export function LiveRoundParticipantRsvpCorrectionPanel({
  roundId,
  participants,
}: Readonly<{
  roundId: string;
  participants: readonly LiveRoundScoreParticipant[];
}>) {
  const playingParticipants = participants.filter(
    (participant) => participant.rsvpStatus === "playing",
  );

  return (
    <section
      className="group-roles-panel"
      aria-labelledby="live-rsvp-correction-title"
    >
      <div className="group-panel-heading">
        <div>
          <p className="ledger-kicker">Round-day operations</p>
          <h2 id="live-rsvp-correction-title">Correct a live RSVP</h2>
        </div>
        <p>{playingParticipants.length} Playing</p>
      </div>
      <p>
        Use this coordinator/admin correction when a Playing participant must be
        removed after score entry. The current score is removed from the live
        projection and retained as invalidated history; enter a reason and
        confirm the effect before saving.
      </p>
      {playingParticipants.length === 0 ? (
        <p className="group-empty" role="status">
          No Playing participants need an RSVP correction.
        </p>
      ) : (
        <div className="group-role-list">
          {playingParticipants.map((participant) => (
            <ParticipantRsvpCorrection
              key={participant.participantId}
              roundId={roundId}
              participant={participant}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function ParticipantRsvpCorrection({
  roundId,
  participant,
}: Readonly<{
  roundId: string;
  participant: LiveRoundScoreParticipant;
}>) {
  const router = useRouter();
  const [rsvpStatus, setRsvpStatus] = useState(participant.rsvpStatus);
  const [participantVersion, setParticipantVersion] = useState(
    participant.participantVersion,
  );
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"error" | "success" | "">("");
  const [pending, startTransition] = useTransition();
  const operationId = useRef<string | null>(null);

  const name = [participant.firstName, participant.lastName]
    .filter((value): value is string => Boolean(value?.trim()))
    .join(" ")
    .trim();
  const displayName = name || "Unnamed participant";
  const playerLabel =
    participant.participantKind === "guest"
      ? `${displayName} · Guest`
      : displayName;
  const scoreReady = participant.score.version > 0;
  const canEdit = participant.canEdit && rsvpStatus === "playing";
  const formId = `live-rsvp-correction-${participant.participantId}`;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || !canEdit) return;
    const normalizedReason = reason.trim();
    if (!scoreReady) {
      setMessage("A confirmed score is required before this correction.");
      setMessageTone("error");
      return;
    }
    if (!normalizedReason) {
      setMessage("Add a reason before marking this participant Not Playing.");
      setMessageTone("error");
      return;
    }
    if (
      !window.confirm(
        `Mark ${playerLabel} Not Playing? Their current score will be removed from the live leaderboard and retained as invalidated history.`,
      )
    ) {
      return;
    }

    operationId.current ??= crypto.randomUUID();
    const parsed = liveRoundParticipantNotPlayingInputSchema.safeParse({
      roundId,
      participantId: participant.participantId,
      expectedParticipantVersion: participantVersion,
      confirmed: true,
      reason: normalizedReason,
      operationId: operationId.current,
    });
    if (!parsed.success) {
      setMessage("Review the correction reason and participant version.");
      setMessageTone("error");
      return;
    }

    startTransition(async () => {
      let result: Awaited<
        ReturnType<typeof setLiveRoundParticipantNotPlayingAction>
      >;
      try {
        result = await setLiveRoundParticipantNotPlayingAction(parsed.data);
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
          result.error.code === "locked" ||
          result.error.code === "operation_reused"
        ) {
          operationId.current = null;
        }
        if (
          result.error.code === "stale_version" ||
          result.error.code === "locked"
        ) {
          setMessage(
            result.error.code === "stale_version"
              ? "This participant changed. Refresh the live round before retrying."
              : "The live round no longer accepts this correction. Refresh the live round.",
          );
          router.refresh();
        }
        return;
      }

      setRsvpStatus(result.data.rsvpStatus);
      setParticipantVersion(result.data.version);
      setReason("");
      setMessage(
        result.data.scoreInvalidated
          ? "Marked Not Playing. The score was removed from live results and retained as invalidated history."
          : "Marked Not Playing.",
      );
      setMessageTone("success");
      operationId.current = null;
      router.refresh();
    });
  }

  return (
    <article className="group-role-row" data-rsvp-state={rsvpStatus}>
      <div className="group-panel-heading">
        <div>
          <h3>{playerLabel}</h3>
          <p>
            {rsvpStatus === "playing"
              ? `Playing · participant version ${participantVersion}`
              : `Not Playing · participant version ${participantVersion}`}
          </p>
        </div>
        <p>{rsvpStatus === "playing" ? "Playing" : "Not Playing"}</p>
      </div>

      {rsvpStatus === "playing" ? (
        <form
          className="group-profile-form"
          onSubmit={submit}
          aria-busy={pending}
          noValidate
        >
          <label className="field-group" htmlFor={`${formId}-reason`}>
            <span>Correction reason</span>
            <textarea
              id={`${formId}-reason`}
              value={reason}
              onChange={(event) => {
                setReason(event.target.value);
                operationId.current = null;
                setMessage("");
                setMessageTone("");
              }}
              maxLength={500}
              rows={2}
              disabled={pending || !canEdit}
              aria-describedby={`${formId}-help`}
            />
            <small id={`${formId}-help`} className="field-help">
              Required. This correction removes the confirmed live score and
              retains it as invalidated history.
            </small>
          </label>
          {!scoreReady ? (
            <p className="field-help">
              A confirmed score is required by the server before this correction
              can be applied.
            </p>
          ) : null}
          {message ? (
            <p className={`form-message ${messageTone}`} role="status">
              {message}
            </p>
          ) : null}
          <button
            className="secondary-button"
            type="submit"
            disabled={pending || !canEdit || !scoreReady}
          >
            {pending ? "Saving correction…" : "Mark Not Playing"}
          </button>
        </form>
      ) : (
        <p className="form-message success" role="status">
          This participant is Not Playing; score entry is locked.
        </p>
      )}
    </article>
  );
}
