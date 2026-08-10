"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { setRoundScoreFieldsAction } from "@/app/actions/rounds";
import type { RoundFormat } from "@/domain/round-drafts";

export function RoundScoreFieldsPanel({
  roundId,
  format,
  enableGrossScore,
  enableNetScore,
  version,
}: Readonly<{
  roundId: string;
  format: RoundFormat;
  enableGrossScore?: boolean;
  enableNetScore?: boolean;
  version: number;
}>) {
  const router = useRouter();
  const [grossScore, setGrossScore] = useState(enableGrossScore ?? false);
  const [netScore, setNetScore] = useState(
    format === "individual_gross" ? false : (enableNetScore ?? false),
  );
  const [savedVersion, setSavedVersion] = useState(version);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"error" | "success" | "">("");
  const [pending, startTransition] = useTransition();
  const operationId = useRef<string | null>(null);

  const dirty =
    grossScore !== (enableGrossScore ?? false) ||
    netScore !==
      (format === "individual_gross" ? false : (enableNetScore ?? false));

  useEffect(() => {
    if (!dirty) return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [dirty]);

  function save() {
    if (!dirty || pending) return;
    setMessage("");
    setMessageTone("");
    const currentOperationId = operationId.current ?? crypto.randomUUID();
    operationId.current = currentOperationId;
    startTransition(async () => {
      let result: Awaited<ReturnType<typeof setRoundScoreFieldsAction>>;
      try {
        result = await setRoundScoreFieldsAction({
          roundId,
          enableGrossScore: grossScore,
          enableNetScore: netScore,
          expectedRoundVersion: savedVersion,
          operationId: currentOperationId,
        });
      } catch {
        setMessage("You cannot save these score fields right now. Try again.");
        setMessageTone("error");
        return;
      }
      if (!result.ok) {
        setMessage(result.error.message);
        setMessageTone("error");
        if (result.error.code === "stale_version") {
          operationId.current = null;
        }
        return;
      }
      operationId.current = null;
      setSavedVersion(result.data.version);
      setMessage("You can use these score fields for this round.");
      setMessageTone("success");
      router.refresh();
    });
  }

  return (
    <section
      className="group-profile-panel"
      aria-labelledby="score-fields-title"
    >
      <div className="group-panel-heading">
        <div>
          <p className="ledger-kicker">Format setup</p>
          <h2 id="score-fields-title">Score fields</h2>
        </div>
        <p>You are editing a draft.</p>
      </div>
      <p className="field-help">
        Choose which final totals you can enter when you score this round. You
        enter golf points for every player.
      </p>
      <div className="precision-options">
        <label className="bound-choice" htmlFor="round-enable-gross-score">
          <input
            id="round-enable-gross-score"
            type="checkbox"
            checked={grossScore}
            onChange={(event) => setGrossScore(event.target.checked)}
            disabled={pending}
          />
          You can enter a gross score
        </label>
        <label className="bound-choice" htmlFor="round-enable-net-score">
          <input
            id="round-enable-net-score"
            type="checkbox"
            checked={netScore}
            onChange={(event) => setNetScore(event.target.checked)}
            disabled={pending || format === "individual_gross"}
          />
          You can enter a net score
        </label>
      </div>
      {format === "individual_gross" ? (
        <p className="field-help">
          You cannot enter a net score for Individual Gross.
        </p>
      ) : null}
      <p
        className="form-message"
        aria-live="polite"
        data-status={messageTone || undefined}
      >
        {message}
      </p>
      <div className="information-actions">
        <button
          className="primary-button"
          type="button"
          onClick={save}
          disabled={pending || !dirty}
        >
          {pending ? "Saving…" : "Save your score fields"}
        </button>
      </div>
    </section>
  );
}
