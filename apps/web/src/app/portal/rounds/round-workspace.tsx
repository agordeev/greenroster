"use client";

import { useState } from "react";

import type { RoundDraftFormValue, RoundFormat } from "@/domain/round-drafts";
import type { RoundCoordinatorDetail } from "@/domain/round-detail";
import type { RoundPublicationReview } from "@/domain/round-publication";
import type { LiveRoundScoreParticipant } from "@/domain/round-score";
import type { RoundHoleScoreRow } from "@/domain/round-hole-scorecard";
import type { RoundMessage } from "@/domain/clubhouse-content";
import type {
  MemberOfficialResult,
  MemberOfficialRound,
} from "@/lib/rounds/member-results-data";
import type { RoundCompletionPreview } from "@/domain/round-completion";

import { PublicationReviewPanel } from "./publication-review";
import { RoundCancellationPanel } from "./round-cancellation-panel";
import { RoundDraftForm } from "./round-draft-form";
import { RoundScoreFieldsPanel } from "./round-score-fields-panel";
import { RoundReadOnlyDetail } from "./round-read-only-detail";
import { PublishedRoundEditPanel } from "./published-round-edit-panel";
import { RoundScoringPanel } from "./round-scoring-panel";
import { LiveRoundScoreboard } from "./live-round-scoreboard";
import { LiveRoundScoreEntryPanel } from "./live-round-score-entry-panel";
import { LiveRoundParticipantRsvpCorrectionPanel } from "./live-round-participant-rsvp-correction-panel";
import { OfficialResultsPanel } from "./official-results-panel";
import { RoundCompletionPanel } from "./round-completion-panel";
import { RoundGuestPanel } from "./round-guest-panel";
import { RoundAnnouncementPanel } from "./round-announcement-panel";
import { ScoreboardAccessPanel } from "./scoreboard-access-panel";
import { RoundHoleScorecardPanel } from "./round-hole-scorecard-panel";
import { RoundMessagePanel } from "./round-message-panel";

export function RoundWorkspace({
  identityKey,
  initialValue,
  roundId,
  format,
  enableGrossScore,
  enableNetScore,
  description,
  state,
  version,
  publicationReview,
  publicationReviewUnavailable,
  roundDetail,
  roundDetailUnavailable,
  roundMessages,
  liveScores,
  liveScoresUnavailable,
  holeScores,
  holeScoresUnavailable,
  officialResults,
  officialResultsUnavailable,
  completionPreview,
  completionPreviewUnavailable,
}: Readonly<{
  identityKey: string;
  initialValue: RoundDraftFormValue;
  roundId: string | null;
  format: RoundFormat | null;
  enableGrossScore?: boolean;
  enableNetScore?: boolean;
  description: string;
  state: RoundDraftFormValue["state"];
  version: number;
  publicationReview: RoundPublicationReview | null;
  publicationReviewUnavailable: boolean;
  roundDetail: RoundCoordinatorDetail | null;
  roundDetailUnavailable: boolean;
  roundMessages: readonly RoundMessage[];
  liveScores: readonly LiveRoundScoreParticipant[];
  liveScoresUnavailable: boolean;
  holeScores: readonly RoundHoleScoreRow[];
  holeScoresUnavailable: boolean;
  officialResults: Readonly<{
    round: MemberOfficialRound;
    results: readonly MemberOfficialResult[];
  }> | null;
  officialResultsUnavailable: boolean;
  completionPreview: RoundCompletionPreview | null;
  completionPreviewUnavailable: boolean;
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
            <p>Refresh the page to see the round details and player list.</p>
          </section>
        ) : (
          <RoundReadOnlyDetail detail={roundDetail} />
        )}

        {roundId && (state === "published" || state === "live") ? (
          <RoundAnnouncementPanel roundId={roundId} />
        ) : null}
        {roundId &&
        (state === "published" || state === "live" || state === "completed") ? (
          <RoundMessagePanel
            roundId={roundId}
            initialMessages={roundMessages}
          />
        ) : null}

        {roundId &&
        roundDetail &&
        (state === "published" || state === "live") ? (
          <RoundGuestPanel
            format={roundDetail.format}
            participants={roundDetail.participants}
            roundId={roundId}
            state={state}
          />
        ) : null}

        {state === "completed" ? (
          <OfficialResultsPanel
            data={officialResults}
            unavailable={officialResultsUnavailable}
          />
        ) : null}

        {roundId && (state === "live" || state === "completed") ? (
          <RoundCompletionPanel
            roundId={roundId}
            description={description}
            state={state}
            version={version}
            preview={completionPreview}
            unavailable={completionPreviewUnavailable}
            officialResults={officialResults}
          />
        ) : null}

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
              <p className="ledger-kicker">Round day</p>
              <h2 id="live-scoreboard-unavailable-title">
                Live scorecard is unavailable
              </h2>
              <p>
                Scores could not be loaded. Refresh the page before you check
                the leaderboard or enter a correction.
              </p>
            </section>
          ) : (
            <>
              <LiveRoundScoreboard participants={liveScores} />
              <ScoreboardAccessPanel roundId={roundId} />
              <LiveRoundScoreEntryPanel participants={liveScores} />
              <LiveRoundParticipantRsvpCorrectionPanel
                roundId={roundId}
                participants={liveScores}
              />
            </>
          )
        ) : null}

        {roundId &&
        (state === "published" || state === "live" || state === "completed") ? (
          holeScoresUnavailable ? (
            <section
              className="group-roles-panel"
              aria-labelledby="round-hole-scorecard-unavailable-title"
            >
              <p className="ledger-kicker">Scoring</p>
              <h2 id="round-hole-scorecard-unavailable-title">
                Hole scorecard is unavailable
              </h2>
              <p>Refresh the page to enter or review hole details.</p>
            </section>
          ) : (
            <RoundHoleScorecardPanel rows={holeScores} state={state} />
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

      {roundId && format ? (
        <RoundScoreFieldsPanel
          roundId={roundId}
          format={format}
          enableGrossScore={enableGrossScore}
          enableNetScore={enableNetScore}
          version={version}
        />
      ) : null}

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
              Players could not be checked. Refresh the page before you publish.
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
