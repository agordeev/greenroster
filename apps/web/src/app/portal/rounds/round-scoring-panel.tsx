"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";

import { openRoundScoringAction } from "@/app/actions/rounds";
import {
  roundScoringBlockedByDraftChanges,
  roundScoringInputSchema,
} from "@/domain/round-scoring";

export function RoundScoringPanel({
  description,
  draftDirty,
  roundId,
  version,
}: Readonly<{
  description: string;
  draftDirty: boolean;
  roundId: string;
  version: number;
}>) {
  const router = useRouter();
  const operationId = useRef<string | null>(null);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"error" | "success" | "">("");
  const [pending, startTransition] = useTransition();

  function openScoring() {
    setMessage("");
    setMessageTone("");
    if (roundScoringBlockedByDraftChanges(draftDirty)) {
      setMessage(
        "Save or discard your changes to the published round before you open scoring.",
      );
      setMessageTone("error");
      return;
    }
    if (
      !window.confirm(
        `Open scoring for “${description}”? The round will go live and score entry will be turned on.`,
      )
    ) {
      return;
    }

    operationId.current ??= crypto.randomUUID();
    const parsed = roundScoringInputSchema.safeParse({
      confirmed: true,
      expectedRoundVersion: version,
      operationId: operationId.current,
      roundId,
    });
    if (!parsed.success) {
      setMessage("Refresh the page, then open scoring again.");
      setMessageTone("error");
      return;
    }

    startTransition(async () => {
      let result: Awaited<ReturnType<typeof openRoundScoringAction>>;
      try {
        result = await openRoundScoringAction(parsed.data);
      } catch {
        setMessage("Scoring didn't open. Try again.");
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
          router.refresh();
        }
        return;
      }

      operationId.current = null;
      setMessage("Scoring is open. The round is live.");
      setMessageTone("success");
      router.refresh();
    });
  }

  return (
    <section
      className="group-roles-panel"
      aria-labelledby="open-round-scoring-title"
    >
      <div className="group-panel-heading">
        <div>
          <p className="ledger-kicker">Round day</p>
          <h2 id="open-round-scoring-title">Open scoring</h2>
        </div>
        <p>Published</p>
      </div>
      <p>
        Opening scoring makes this round live and turns on score entry. Open it
        when players are ready to be scored. The change is kept in the round
        history.
      </p>
      {roundScoringBlockedByDraftChanges(draftDirty) ? (
        <p className="form-message error" role="status">
          Save or discard your changes to the published round before you open
          scoring.
        </p>
      ) : null}
      {message ? (
        <p className={`form-message ${messageTone}`} role="status">
          {message}
        </p>
      ) : null}
      <div className="group-profile-form" aria-busy={pending}>
        <button
          className="primary-button"
          type="button"
          disabled={pending || roundScoringBlockedByDraftChanges(draftDirty)}
          onClick={openScoring}
        >
          {pending ? "Opening scoring…" : "Open scoring"}
        </button>
      </div>
    </section>
  );
}
