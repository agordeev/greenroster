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
        "Save or discard the published round changes before opening scoring.",
      );
      setMessageTone("error");
      return;
    }
    if (
      !window.confirm(
        `Open scoring for “${description}”? The Published round will become Live and score entry will be enabled.`,
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
      setMessage("Refresh the selected round before opening scoring.");
      setMessageTone("error");
      return;
    }

    startTransition(async () => {
      let result: Awaited<ReturnType<typeof openRoundScoringAction>>;
      try {
        result = await openRoundScoringAction(parsed.data);
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
          router.refresh();
        }
        return;
      }

      operationId.current = null;
      setMessage("Scoring is now open. This round is Live.");
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
          <p className="ledger-kicker">Round-day operations</p>
          <h2 id="open-round-scoring-title">Open scoring</h2>
        </div>
        <p>Version {version}</p>
      </div>
      <p>
        Opening scoring changes this Published round to Live. Confirm the
        transition when players are ready to enter scores. The server records
        the authorized action and its audit event.
      </p>
      {roundScoringBlockedByDraftChanges(draftDirty) ? (
        <p className="form-message error" role="status">
          Save or discard the published round changes before opening scoring.
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
