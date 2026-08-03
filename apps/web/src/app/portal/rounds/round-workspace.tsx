"use client";

import { useState } from "react";

import type { RoundDraftFormValue, RoundFormat } from "@/domain/round-drafts";
import type { RoundCoordinatorDetail } from "@/domain/round-detail";
import type { RoundPublicationReview } from "@/domain/round-publication";
import type { LiveRoundScoreParticipant } from "@/domain/round-score";

import { PublicationReviewPanel } from "./publication-review";
import { RoundCancellationPanel } from "./round-cancellation-panel";
import { RoundDraftForm } from "./round-draft-form";
import { RoundReadOnlyDetail } from "./round-read-only-detail";
import { PublishedRoundEditPanel } from "./published-round-edit-panel";
import { RoundScoringPanel } from "./round-scoring-panel";
import { LiveRoundScoreboard } from "./live-round-scoreboard";
import { LiveRoundScoreEntryPanel } from "./live-round-score-entry-panel";
import { LiveRoundParticipantRsvpCorrectionPanel } from "./live-round-participant-rsvp-correction-panel";

export function RoundWorkspace({
  identityKey,
  initialValue,
  roundId,
  format,
  description,
  state,
  version,
  publicationReview,
  publicationReviewUnavailable,
  roundDetail,
  roundDetailUnavailable,
  liveScores,
  liveScoresUnavailable,
}: Readonly<{
  identityKey: string;
  initialValue: RoundDraftFormValue;
  roundId: string | null;
  format: RoundFormat | null;
  description: string;
  state: RoundDraftFormValue["state"];
  version: number;
  publicationReview: RoundPublicationReview | null;
  publicationReviewUnavailable: boolean;
  roundDetail: RoundCoordinatorDetail | null;
  roundDetailUnavailable: boolean;
  liveScores: readonly LiveRoundScoreParticipant[];
  liveScoresUnavailable: boolean;
}>) {
  const [draftDirty, setDraftDirty] = useState(false);

  if (state !== "draft") {
    return (
      <>
        {roundDetailUnavailable || !roundDetail ? (
          <section
            className="group-roles-panel"
            aria-labelledby="round-detail-unavailable-title"
          >
            <p className="ledger-kicker">Round detail</p>
            <h2 id="round-detail-unavailable-title">
              Round detail is unavailable
            </h2>
            <p>
              The confirmed round detail service is temporarily unavailable.
              Refresh before relying on the participant snapshots.
            </p>
          </section>
        ) : (
          <RoundReadOnlyDetail detail={roundDetail} />
        )}

        {roundId &&
        state === "published" &&
        roundDetail?.state === "published" ? (
          <PublishedRoundEditPanel
            roundId={roundId}
            detail={roundDetail}
            onDirtyChange={setDraftDirty}
          />
        ) : null}

        {roundId && state === "live" ? (
          liveScoresUnavailable ? (
            <section
              className="group-roles-panel"
              aria-labelledby="live-scoreboard-unavailable-title"
            >
              <p className="ledger-kicker">Round-day operations</p>
              <h2 id="live-scoreboard-unavailable-title">
                Live scorecard is unavailable
              </h2>
              <p>
                The confirmed score projection could not be loaded. Refresh
                before relying on the leaderboard or entering a correction.
              </p>
            </section>
          ) : (
            <>
              <LiveRoundScoreboard participants={liveScores} />
              <LiveRoundScoreEntryPanel participants={liveScores} />
              <LiveRoundParticipantRsvpCorrectionPanel
                roundId={roundId}
                participants={liveScores}
              />
            </>
          )
        ) : null}

        {roundId &&
        state === "published" &&
        roundDetail?.state === "published" ? (
          <RoundScoringPanel
            description={description}
            draftDirty={draftDirty}
            roundId={roundId}
            version={version}
          />
        ) : null}

        {roundId && (state === "published" || state === "live") ? (
          <RoundCancellationPanel
            roundId={roundId}
            description={description}
            state={state}
            version={version}
            draftDirty={draftDirty}
          />
        ) : null}
      </>
    );
  }

  return (
    <>
      <RoundDraftForm
        identityKey={identityKey}
        initialValue={initialValue}
        onDirtyChange={setDraftDirty}
      />

      {roundId &&
      (state === "draft" || state === "published" || state === "live") ? (
        <RoundCancellationPanel
          roundId={roundId}
          description={description}
          state={state}
          version={version}
          draftDirty={draftDirty}
        />
      ) : null}

      {roundId && format ? (
        publicationReviewUnavailable || !publicationReview ? (
          <section
            className="group-roles-panel"
            aria-labelledby="publication-review-unavailable-title"
          >
            <p className="ledger-kicker">Publication review</p>
            <h2 id="publication-review-unavailable-title">
              Publication review is unavailable
            </h2>
            <p>
              The participant readiness service is temporarily unavailable.
              Refresh before publishing.
            </p>
          </section>
        ) : (
          <PublicationReviewPanel
            roundId={roundId}
            initialReview={publicationReview}
            draftDirty={draftDirty}
          />
        )
      ) : null}
    </>
  );
}
