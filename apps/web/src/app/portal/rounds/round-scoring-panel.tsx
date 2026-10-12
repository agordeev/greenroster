"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";

import { openRoundScoringAction } from "@/app/actions/rounds";
import { FormMessage, SectionHeading } from "@/components/blocks";
import { Button } from "@/components/ui/button";
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
        `Open scoring for “${description}”? The round goes live and you can start entering scores.`,
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
        setMessage("We couldn't open scoring. Try again.");
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
      className="page-section"
      aria-labelledby="open-round-scoring-title"
    >
      <SectionHeading
        kicker="Round day"
        title="Open scoring"
        titleId="open-round-scoring-title"
        meta="Published"
      />
      <p>Open scoring when players are ready to tee off.</p>
      {roundScoringBlockedByDraftChanges(draftDirty) ? (
        <FormMessage role="status">
          Save or discard your changes to the published round before you open
          scoring.
        </FormMessage>
      ) : null}
      {message ? (
        <FormMessage
          tone={messageTone === "success" ? "success" : "error"}
          role="status"
        >
          {message}
        </FormMessage>
      ) : null}
      <div className="form-stack" aria-busy={pending}>
        <Button
          type="button"
          disabled={pending || roundScoringBlockedByDraftChanges(draftDirty)}
          onClick={openScoring}
        >
          {pending ? "Opening scoring…" : "Open scoring"}
        </Button>
      </div>
    </section>
  );
}
