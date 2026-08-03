import { describe, expect, it } from "vitest";

import type {
  LiveRoundScoreParticipant,
  RoundScoreCurrentState,
} from "../apps/web/src/domain/round-score";
import {
  changedFieldsFromDraft,
  currentScoreFromStaleDetails,
  enabledRoundScoreFields,
  plusMinusPreviewFromDraft,
  resetScoreMutationContext,
  retainScoreMutationContext,
  scoreDraftFromCurrentScore,
} from "../apps/web/src/app/portal/rounds/live-round-score-entry-state";

const score: RoundScoreCurrentState = {
  participantId: "60000000-0000-4000-8000-000000000001",
  version: 1,
  revisionId: "63000000-0000-4000-8000-000000000001",
  grossScore: "72",
  netScore: null,
  golfPoints: "0.00",
  manualMerit: null,
  plusMinus: "-2.50",
  rankingValue: "-2.50",
  changedAt: "2026-08-03T12:00:01.000Z",
};

const participant = {
  enabledFields: { golfPoints: true, grossScore: true, netScore: false },
  canAuthorManualMerit: false,
} satisfies Pick<
  LiveRoundScoreParticipant,
  "enabledFields" | "canAuthorManualMerit"
>;

describe("live round score entry state", () => {
  it("exposes only enabled authored fields and coordinator manual merit authority", () => {
    expect(enabledRoundScoreFields(participant)).toEqual([
      "golf_points",
      "gross_score",
    ]);
    expect(
      enabledRoundScoreFields({
        enabledFields: { golfPoints: true, grossScore: false, netScore: true },
        canAuthorManualMerit: true,
      }),
    ).toEqual(["golf_points", "net_score", "manual_merit"]);
  });

  it("keeps Missing distinct from a confirmed zero", () => {
    const draft = scoreDraftFromCurrentScore(score);
    expect(draft.golf_points).toBe("0.00");
    expect(draft.net_score).toBe("");
    expect(
      changedFieldsFromDraft(
        { ...draft, golf_points: "0", net_score: "" },
        score,
        ["golf_points", "net_score"],
      ).changedFields,
    ).toEqual({});
    expect(
      changedFieldsFromDraft(
        { ...draft, golf_points: "", net_score: "0" },
        score,
        ["golf_points", "net_score"],
      ).changedFields,
    ).toEqual({ golf_points: null, net_score: 0 });
  });

  it("accepts the authorized current score from stale mutation details", () => {
    expect(
      currentScoreFromStaleDetails(
        { currentScore: score },
        score.participantId,
      ),
    ).toEqual(score);
    expect(
      currentScoreFromStaleDetails(
        { currentScore: { ...score, participantId: "different" } },
        score.participantId,
      ),
    ).toBeNull();
  });

  it("retains all idempotency inputs across a lost-response retry", () => {
    const initial = resetScoreMutationContext();
    let generatedId = 0;
    const first = retainScoreMutationContext(
      initial,
      () => `id-${++generatedId}`,
      () => "2026-08-03T12:00:00.000Z",
    );
    const retry = retainScoreMutationContext(
      first,
      () => `id-${++generatedId}`,
      () => "2026-08-03T12:01:00.000Z",
    );

    expect(retry).toEqual({
      operationId: "id-1",
      deviceOperationId: "id-2",
      clientChangedAt: "2026-08-03T12:00:00.000Z",
    });
    expect(resetScoreMutationContext()).toEqual({
      operationId: null,
      deviceOperationId: null,
      clientChangedAt: null,
    });
  });

  it("previews server-style plus/minus from typed points without making it official", () => {
    expect(
      plusMinusPreviewFromDraft(
        { quotaSnapshot: "12.30" },
        { golf_points: "20" },
      ),
    ).toBe("7.70");
    expect(
      plusMinusPreviewFromDraft(
        { quotaSnapshot: "12.30" },
        { golf_points: "" },
      ),
    ).toBeNull();
  });
});
