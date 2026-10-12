"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition, type FormEvent } from "react";

import { setLiveRoundParticipantNotPlayingAction } from "@/app/actions/rounds";
import { EmptyState, SectionHeading } from "@/components/ui";
import { liveRoundParticipantNotPlayingInputSchema } from "@/domain/live-round-participant-rsvp-correction";
import type {
  LiveRoundScoreParticipant,
  RoundScoreCurrentState,
} from "@/domain/round-score";

import { currentScoreFromStaleDetails } from "./live-round-score-entry-state";

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
      className="page-section"
      aria-labelledby="live-rsvp-correction-title"
    >
      <SectionHeading
        kicker="Round day"
        title="Mark a player not playing"
        titleId="live-rsvp-correction-title"
        meta={<>{playingParticipants.length} playing</>}
      />
      <p>
        Use this if a playing player has to be marked not playing after their
        score was entered. Their score comes off the live leaderboard but stays
        in the round history. Add a reason, then confirm before you save.
      </p>
      {playingParticipants.length === 0 ? (
        <EmptyState>No players are playing right now.</EmptyState>
      ) : (
        <div className="row-list">
          {playingParticipants.map((participant) => (
            <ParticipantRsvpCorrection
              key={participantSyncKey(participant)}
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
  const [score, setScore] = useState<RoundScoreCurrentState>(participant.score);
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"error" | "success" | "">("");
  const [pending, startTransition] = useTransition();
  const operationId = useRef<string | null>(null);

  const name = [participant.firstName, participant.lastName]
    .filter((value): value is string => Boolean(value?.trim()))
    .join(" ")
    .trim();
  const displayName = name || "Unnamed player";
  const playerLabel =
    participant.participantKind === "guest"
      ? `${displayName} · Guest`
      : displayName;
  const scoreReady = score.version > 0 && score.revisionId !== null;
  const canEdit = participant.canEdit && rsvpStatus === "playing";
  const formId = `live-rsvp-correction-${participant.participantId}`;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || !canEdit) return;
    const normalizedReason = reason.trim();
    if (!scoreReady) {
      setMessage(
        "A score must be entered before you can make this correction.",
      );
      setMessageTone("error");
      return;
    }
    if (!normalizedReason) {
      setMessage("Add a reason before you mark this player not playing.");
      setMessageTone("error");
      return;
    }
    if (
      !window.confirm(
        `Mark ${playerLabel} not playing? Their score will come off the live leaderboard and stay in the round history.`,
      )
    ) {
      return;
    }

    operationId.current ??= crypto.randomUUID();
    const parsed = liveRoundParticipantNotPlayingInputSchema.safeParse({
      roundId,
      participantId: participant.participantId,
      expectedParticipantVersion: participantVersion,
      expectedScoreVersion: score.version,
      expectedScoreRevisionId: score.revisionId,
      confirmed: true,
      reason: normalizedReason,
      operationId: operationId.current,
    });
    if (!parsed.success) {
      setMessage("Check the correction reason, then try again.");
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
        if (result.error.code === "stale_version") {
          const currentScore = currentScoreFromStaleDetails(
            result.error.details,
            participant.participantId,
          );
          if (currentScore) setScore(currentScore);
          setReason("");
        }
        if (
          result.error.code === "stale_version" ||
          result.error.code === "locked"
        ) {
          setMessage(
            result.error.code === "stale_version"
              ? "This player's score changed. The current score is shown below. Refresh the page and confirm again."
              : "This round no longer accepts this correction. Refresh the page.",
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
          ? "Marked not playing. The score was removed from the live results and kept in the round history."
          : "Marked not playing.",
      );
      setMessageTone("success");
      operationId.current = null;
      router.refresh();
    });
  }

  return (
    <article className="row-item" data-rsvp-state={rsvpStatus}>
      <div className="section-heading">
        <div>
          <h3>{playerLabel}</h3>
          <p>
            {rsvpStatus === "playing"
              ? "Playing"
              : "Not playing. Score entry is locked."}
          </p>
        </div>
        <p>{rsvpStatus === "playing" ? "Playing" : "Not playing"}</p>
      </div>

      <dl className="group-profile-facts">
        <div>
          <dt>Golf points</dt>
          <dd>{formatScore(score.golfPoints)}</dd>
        </div>
        <div>
          <dt>Plus/minus</dt>
          <dd>{formatScore(score.plusMinus)}</dd>
        </div>
        <div>
          <dt>Ranking value</dt>
          <dd>{formatScore(score.rankingValue)}</dd>
        </div>
        <div>
          <dt>Score</dt>
          <dd>{score.version > 0 ? "Entered" : "Missing"}</dd>
        </div>
      </dl>

      {rsvpStatus === "playing" ? (
        <form
          className="form-stack"
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
              Required. This removes the live score but keeps it in the round
              history.
            </small>
          </label>
          {!scoreReady ? (
            <p className="field-help">
              A score must be entered before this correction can be made.
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
            {pending ? "Saving correction…" : "Mark not playing"}
          </button>
        </form>
      ) : (
        <p className="form-message success" role="status">
          This player is not playing. Score entry is locked.
        </p>
      )}
    </article>
  );
}

function participantSyncKey(participant: LiveRoundScoreParticipant): string {
  return [
    participant.participantId,
    participant.rsvpStatus,
    participant.participantVersion,
    participant.score.version,
    participant.score.revisionId ?? "missing",
  ].join(":");
}

function formatScore(value: string | null): string {
  return value === null ? "Missing" : value;
}
