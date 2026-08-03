"use client";

import { useState } from "react";

import type { RoundDraftFormValue, RoundFormat } from "@/domain/round-drafts";
import type { RoundPublicationReview } from "@/domain/round-publication";

import { PublicationReviewPanel } from "./publication-review";
import { RoundDraftForm } from "./round-draft-form";

export function RoundWorkspace({
  identityKey,
  initialValue,
  roundId,
  format,
  publicationReview,
  publicationReviewUnavailable,
}: Readonly<{
  identityKey: string;
  initialValue: RoundDraftFormValue;
  roundId: string | null;
  format: RoundFormat | null;
  publicationReview: RoundPublicationReview | null;
  publicationReviewUnavailable: boolean;
}>) {
  const [draftDirty, setDraftDirty] = useState(false);

  return (
    <>
      <RoundDraftForm
        identityKey={identityKey}
        initialValue={initialValue}
        onDirtyChange={setDraftDirty}
      />

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
