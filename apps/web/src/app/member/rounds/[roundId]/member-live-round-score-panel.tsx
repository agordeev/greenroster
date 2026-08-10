"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition, type FormEvent } from "react";

import { setMemberRoundParticipantScoreAction } from "@/app/actions/rounds";
import {
  roundScoreInputSchema,
  type LiveRoundScoreParticipant,
  type RoundScoreCurrentState,
  type RoundScoreField,
} from "@/domain/round-score";

import {
  changedFieldsFromDraft,
  currentScoreFromStaleDetails,
  enabledRoundScoreFields,
  resetScoreMutationContext,
  retainScoreMutationContext,
  scoreDraftFromCurrentScore,
  scoreValueForField,
  type LiveRoundScoreDraft,
  type ScoreMutationContext,
} from "../../../portal/rounds/live-round-score-entry-state";

const fieldLabels: Readonly<Record<RoundScoreField, string>> = {
  golf_points: "Golf points",
  gross_score: "Gross score",
  net_score: "Net score",
  manual_merit: "Manual merit",
};

const fieldConstraints: Readonly<
  Record<RoundScoreField, { min: number; max: number; step: string }>
> = {
  golf_points: { min: 0, max: 100, step: "0.01" },
  gross_score: { min: 0, max: 300, step: "1" },
  net_score: { min: 0, max: 300, step: "1" },
  manual_merit: { min: -1000, max: 1000, step: "0.01" },
};

export function MemberLiveRoundScorePanel({
  participants,
}: Readonly<{
  participants: readonly LiveRoundScoreParticipant[];
}>) {
  const editable = participants.filter((participant) => participant.canEdit);
  return (
    <section
      className="group-roles-panel live-score-entry"
      aria-labelledby="member-live-score-title"
    >
      <div className="group-panel-heading">
        <div>
          <p className="ledger-kicker">Round-day scoring</p>
          <h2 id="member-live-score-title">Your live score</h2>
        </div>
        <p>
          {editable.length} score{editable.length === 1 ? "" : "s"} you can edit
        </p>
      </div>
      <p>
        You enter the enabled values for yourself or a guest you sponsor. The
        server confirms each value and calculates plus/minus for you.
      </p>
      {editable.length === 0 ? (
        <p className="group-empty" role="status">
          You cannot edit a score until you respond Playing.
        </p>
      ) : (
        <div className="group-role-list">
          {editable.map((participant) => (
            <MemberParticipantScoreEditor
              key={participant.participantId}
              participant={participant}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function MemberParticipantScoreEditor({
  participant,
}: Readonly<{ participant: LiveRoundScoreParticipant }>) {
  const router = useRouter();
  const [score, setScore] = useState<RoundScoreCurrentState>(participant.score);
  const [draft, setDraft] = useState<LiveRoundScoreDraft>(() =>
    scoreDraftFromCurrentScore(participant.score),
  );
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"error" | "success" | "">("");
  const [pending, startTransition] = useTransition();
  const mutationContext = useRef<ScoreMutationContext>(
    resetScoreMutationContext(),
  );
  const fields = enabledRoundScoreFields(participant).filter(
    (field) => field !== "manual_merit",
  );
  const name = [participant.firstName, participant.lastName]
    .filter((value): value is string => Boolean(value?.trim()))
    .join(" ")
    .trim();
  const label = name || "Unnamed player";
  const playerLabel =
    participant.participantKind === "guest" ? `${label} · Guest` : label;
  const scoreState = score.version === 0 ? "Missing" : "Confirmed";
  const readOnly = participant.rsvpStatus !== "playing";

  function updateDraft(field: RoundScoreField, value: string) {
    setDraft((current) => ({ ...current, [field]: value }));
    mutationContext.current = resetScoreMutationContext();
    setMessage("");
    setMessageTone("");
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || readOnly) return;
    const { changedFields, invalidField } = changedFieldsFromDraft(
      draft,
      score,
      fields,
    );
    if (invalidField) {
      setMessage(
        `You enter a valid ${fieldLabels[invalidField].toLowerCase()}.`,
      );
      setMessageTone("error");
      return;
    }
    if (Object.keys(changedFields).length === 0) {
      setMessage("You change at least one score field before saving.");
      setMessageTone("error");
      return;
    }
    const normalizedReason = reason.trim();
    const requiresCorrectionReason = Object.keys(changedFields).some(
      (field) => scoreValueForField(score, field as RoundScoreField) !== null,
    );
    if (requiresCorrectionReason && !normalizedReason) {
      setMessage("You add a reason when replacing a confirmed value.");
      setMessageTone("error");
      return;
    }

    mutationContext.current = retainScoreMutationContext(
      mutationContext.current,
      () => crypto.randomUUID(),
      () => new Date().toISOString(),
    );
    const parsed = roundScoreInputSchema.safeParse({
      participantId: participant.participantId,
      changedFields,
      expectedScoreVersion: score.version,
      deviceOperationId: mutationContext.current.deviceOperationId,
      reason: normalizedReason || null,
      clientChangedAt: mutationContext.current.clientChangedAt,
      operationId: mutationContext.current.operationId,
    });
    if (!parsed.success) {
      setMessage("You review the score values and try again.");
      setMessageTone("error");
      return;
    }

    startTransition(async () => {
      let result: Awaited<
        ReturnType<typeof setMemberRoundParticipantScoreAction>
      >;
      try {
        result = await setMemberRoundParticipantScoreAction(parsed.data);
      } catch {
        setMessage("You try again when the score service is available.");
        setMessageTone("error");
        return;
      }
      if (!result.ok) {
        setMessage(result.error.message);
        setMessageTone("error");
        if (result.error.code === "stale_version") {
          const current = currentScoreFromStaleDetails(
            result.error.details,
            participant.participantId,
          );
          if (current) {
            setScore(current);
            setDraft(scoreDraftFromCurrentScore(current));
          }
          mutationContext.current = resetScoreMutationContext();
          router.refresh();
        }
        return;
      }
      const next = scoreFromReceipt(result.data);
      setScore(next);
      setDraft(scoreDraftFromCurrentScore(next));
      setReason("");
      setMessage("You save a score confirmed by the server.");
      setMessageTone("success");
      mutationContext.current = resetScoreMutationContext();
    });
  }

  return (
    <article
      className="group-role-row"
      data-score-state={scoreState.toLowerCase()}
    >
      <div className="group-panel-heading">
        <div>
          <h3>{playerLabel}</h3>
          <p>{readOnly ? "You are not playing." : "You are playing."}</p>
        </div>
        <p>{scoreState}</p>
      </div>
      <form onSubmit={submit}>
        <div className="group-profile-fields">
          {fields.map((field) => {
            const constraint = fieldConstraints[field];
            return (
              <label className="field-group" key={field}>
                <span>{fieldLabels[field]}</span>
                <input
                  type="number"
                  inputMode={field === "golf_points" ? "decimal" : "numeric"}
                  min={constraint.min}
                  max={constraint.max}
                  step={constraint.step}
                  value={draft[field]}
                  onChange={(event) => updateDraft(field, event.target.value)}
                  disabled={pending || readOnly}
                />
              </label>
            );
          })}
        </div>
        <label className="field-group">
          <span>Reason for a correction</span>
          <input
            value={reason}
            maxLength={500}
            onChange={(event) => setReason(event.target.value)}
            disabled={pending || readOnly}
          />
        </label>
        <p className="field-help">
          You see the last confirmed plus/minus:{" "}
          {score.plusMinus ?? "Not available"}.
        </p>
        <button
          className="primary-button"
          type="submit"
          disabled={pending || readOnly}
        >
          {pending ? "Saving score…" : "Save score"}
        </button>
        <p
          className="form-message"
          aria-live="polite"
          data-status={messageTone || undefined}
        >
          {message}
        </p>
      </form>
    </article>
  );
}

function scoreFromReceipt(
  receipt: Readonly<{
    participantId: string;
    version: number;
    revisionId: string;
    grossScore: string | null;
    netScore: string | null;
    golfPoints: string | null;
    manualMerit: string | null;
    plusMinus: string | null;
    rankingValue: string | null;
    changedAt: string;
  }>,
): RoundScoreCurrentState {
  return {
    participantId: receipt.participantId,
    version: receipt.version,
    revisionId: receipt.revisionId,
    grossScore: receipt.grossScore,
    netScore: receipt.netScore,
    golfPoints: receipt.golfPoints,
    manualMerit: receipt.manualMerit,
    plusMinus: receipt.plusMinus,
    rankingValue: receipt.rankingValue,
    changedAt: receipt.changedAt,
  };
}
