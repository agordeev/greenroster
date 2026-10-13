"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition, type FormEvent } from "react";

import { setLiveRoundParticipantNotPlayingAction } from "@/app/actions/rounds";
import {
  EmptyState,
  FieldHelp,
  FormMessage,
  SectionHeading,
} from "@/components/blocks";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
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
      className="mt-10 pt-8 border-t [&>h2]:mx-0 [&>h2]:text-[1.5rem] [&>h2]:font-semibold [&>h2]:mt-1.5! [&>h2]:mb-0!"
      aria-labelledby="live-rsvp-correction-title"
    >
      <SectionHeading
        kicker="Round day"
        title="Mark a player not playing"
        titleId="live-rsvp-correction-title"
        meta={<>{playingParticipants.length} playing</>}
      />
      <p>
        Use this when a player with a score turns out not to be playing. Their
        score comes off the live leaderboard.
      </p>
      {playingParticipants.length === 0 ? (
        <EmptyState>No players are playing right now.</EmptyState>
      ) : (
        <div className="mx-0 mt-6 mb-0 p-0 gap-3 grid list-none">
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
      setMessage("You can only do this for a player who has a score.");
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
        `Mark ${playerLabel} not playing? Their score will come off the live leaderboard.`,
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
      setMessage("Check the reason, then try again.");
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
        setMessage("We couldn't save this change. Try again.");
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
              : "You can't make this change to the round any more. Refresh the page.",
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
          ? "Marked not playing. The score was removed from the live results."
          : "Marked not playing.",
      );
      setMessageTone("success");
      operationId.current = null;
      router.refresh();
    });
  }

  return (
    <article
      className="p-4 gap-4 border border-border/50 flex items-center justify-between rounded-lg max-[720px]:items-start max-[720px]:flex-col [&_p]:mx-0 [&_p]:mb-0 [&_p]:text-muted-foreground [&_p]:mt-[0.35rem]! [&_p]:text-[0.8125rem]!"
      data-rsvp-state={rsvpStatus}
    >
      <div className="gap-4 flex items-end justify-between max-[720px]:items-start max-[720px]:flex-col [&>p]:mx-0 [&>p]:mb-0 [&>p]:text-muted-foreground [&>p]:whitespace-nowrap [&>p]:mt-0! [&>p]:text-[0.75rem]! [&_h2]:mx-0 [&_h2]:mt-1.5 [&_h2]:mb-0 [&_h2]:text-[1.5rem] [&_h2]:font-semibold [&_h3]:mx-0 [&_h3]:mt-1.5 [&_h3]:mb-0">
        <div>
          <h3>{playerLabel}</h3>
          <p>
            {rsvpStatus === "playing"
              ? "Playing"
              : "Not playing, so you can't enter scores."}
          </p>
        </div>
        <p>{rsvpStatus === "playing" ? "Playing" : "Not playing"}</p>
      </div>

      <dl className="mx-0 mt-5 mb-0 gap-4 grid grid-cols-2 max-[720px]:grid-cols-[1fr] [&_dd]:mx-0 [&_dd]:mt-1 [&_dd]:mb-0 [&_dd]:text-muted-foreground [&_dd]:leading-[1.45] [&_dd]:wrap-anywhere [&_dt]:text-muted-foreground [&_dt]:font-mono [&_dt]:text-[0.6875rem] [&_dt]:tracking-[0.08em] [&_dt]:uppercase">
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
          className="mt-5 gap-5 grid [:where(&)>*]:my-0"
          data-slot="form-stack"
          onSubmit={submit}
          aria-busy={pending}
          noValidate
        >
          <label
            className="gap-2 grid [&>label]:text-[0.8125rem] [&>label]:font-bold [&>label]:tracking-[0.015em] [&>span]:text-[0.8125rem] [&>span]:font-bold [&>span]:tracking-[0.015em]"
            data-slot="field"
            htmlFor={`${formId}-reason`}
          >
            <span>Reason for the change</span>
            <Textarea
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
            <small
              id={`${formId}-help`}
              className="m-0 min-h-5 text-[0.8125rem] leading-[1.45] text-muted-foreground [&_a]:text-primary [&_a]:font-bold [&_a]:underline [&_a]:underline-offset-[0.2em]"
              data-slot="field-help"
            >
              Required.
            </small>
          </label>
          {!scoreReady ? (
            <FieldHelp>
              You can only do this for a player who has a score.
            </FieldHelp>
          ) : null}
          {message ? (
            <FormMessage
              tone={messageTone === "success" ? "success" : "error"}
              role="status"
            >
              {message}
            </FormMessage>
          ) : null}
          <Button
            variant="outline"
            type="submit"
            disabled={pending || !canEdit || !scoreReady}
          >
            {pending ? "Saving…" : "Mark not playing"}
          </Button>
        </form>
      ) : null}
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
