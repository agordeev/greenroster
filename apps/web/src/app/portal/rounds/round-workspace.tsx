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
import { Kicker } from "@/components/blocks";

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
            className="mt-10 pt-8 border-t [&>h2]:mx-0 [&>h2]:text-[1.5rem] [&>h2]:font-semibold [&>h2]:mt-1.5! [&>h2]:mb-0!"
            aria-labelledby="round-detail-unavailable-title"
          >
            <Kicker>Round detail</Kicker>
            <h2 id="round-detail-unavailable-title">
              We couldn&apos;t load this round
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
              className="mt-10 pt-8 border-t [&>h2]:mx-0 [&>h2]:text-[1.5rem] [&>h2]:font-semibold [&>h2]:mt-1.5! [&>h2]:mb-0!"
              aria-labelledby="live-scoreboard-unavailable-title"
            >
              <Kicker>Round day</Kicker>
              <h2 id="live-scoreboard-unavailable-title">
                We couldn&apos;t load the live scorecard
              </h2>
              <p>
                Refresh the page before you check the leaderboard or change a
                score.
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
              className="mt-10 pt-8 border-t [&>h2]:mx-0 [&>h2]:text-[1.5rem] [&>h2]:font-semibold [&>h2]:mt-1.5! [&>h2]:mb-0!"
              aria-labelledby="round-hole-scorecard-unavailable-title"
            >
              <Kicker>Scoring</Kicker>
              <h2 id="round-hole-scorecard-unavailable-title">
                We couldn&apos;t load the hole scorecard
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

      {roundId && format ? (
        publicationReviewUnavailable || !publicationReview ? (
          <section
            className="mt-10 pt-8 border-t [&>h2]:mx-0 [&>h2]:text-[1.5rem] [&>h2]:font-semibold [&>h2]:mt-1.5! [&>h2]:mb-0!"
            aria-labelledby="publication-review-unavailable-title"
          >
            <Kicker>Before you publish</Kicker>
            <h2 id="publication-review-unavailable-title">
              We couldn&apos;t check the player list
            </h2>
            <p>Refresh the page before you publish.</p>
          </section>
        ) : (
          <PublicationReviewPanel
            roundId={roundId}
            initialReview={publicationReview}
            draftDirty={draftDirty}
          />
        )
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
    </>
  );
}
