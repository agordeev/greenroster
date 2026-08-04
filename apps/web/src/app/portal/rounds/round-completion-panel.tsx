"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition, type FormEvent } from "react";

import {
  completeLiveRoundAction,
  reopenCompletedRoundAction,
} from "@/app/actions/rounds";
import {
  roundCompletionInputSchema,
  roundReopenInputSchema,
  type RoundCompletionPreview,
} from "@/domain/round-completion";

export function RoundCompletionPanel({
  roundId,
  description,
  state,
  version,
  preview,
  unavailable,
}: Readonly<{
  roundId: string;
  description: string;
  state: "live" | "completed";
  version: number;
  preview: RoundCompletionPreview | null;
  unavailable: boolean;
}>) {
  if (state === "completed") {
    return (
      <RoundReopenPanel
        roundId={roundId}
        description={description}
        version={version}
      />
    );
  }

  return (
    <RoundCompletePanel
      roundId={roundId}
      description={description}
      version={version}
      preview={preview}
      unavailable={unavailable}
    />
  );
}

function RoundCompletePanel({
  roundId,
  description,
  version,
  preview,
  unavailable,
}: Readonly<{
  roundId: string;
  description: string;
  version: number;
  preview: RoundCompletionPreview | null;
  unavailable: boolean;
}>) {
  const router = useRouter();
  const operationId = useRef<string | null>(null);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"error" | "success" | "">("");
  const [pending, startTransition] = useTransition();

  if (unavailable || !preview) {
    return (
      <section
        className="group-roles-panel"
        aria-labelledby="round-completion-unavailable-title"
      >
        <p className="ledger-kicker">Completion review</p>
        <h2 id="round-completion-unavailable-title">
          Completion preview is unavailable
        </h2>
        <p>
          The confirmed server readiness preview could not be loaded. Refresh
          before completing this round.
        </p>
      </section>
    );
  }

  const blockers = preview.readiness.filter((row) => row.status === "blocked");
  const warnings = preview.readiness.filter((row) => row.status === "warning");
  const canComplete =
    preview.serverChecksPassed && preview.mobileSyncCheck === "complete";

  function complete() {
    setMessage("");
    setMessageTone("");
    if (!canComplete) {
      setMessage(
        "Resolve every server blocker and confirm mobile score synchronization before completing.",
      );
      setMessageTone("error");
      return;
    }
    if (
      !window.confirm(
        `Complete “${description}”? The server will publish the official result, merit, quota, and standings effects.`,
      )
    ) {
      return;
    }

    operationId.current ??= crypto.randomUUID();
    const parsed = roundCompletionInputSchema.safeParse({
      roundId,
      expectedRoundVersion: version,
      confirmed: true,
      operationId: operationId.current,
    });
    if (!parsed.success) {
      setMessage("Refresh the selected round before completing it.");
      setMessageTone("error");
      return;
    }

    startTransition(async () => {
      let result: Awaited<ReturnType<typeof completeLiveRoundAction>>;
      try {
        result = await completeLiveRoundAction(parsed.data);
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
      setMessage(
        "Round completed. Official results and standings are now published.",
      );
      setMessageTone("success");
      router.refresh();
    });
  }

  return (
    <section
      className="group-roles-panel"
      aria-labelledby="round-completion-title"
      aria-busy={pending}
    >
      <div className="group-panel-heading">
        <div>
          <p className="ledger-kicker">Completion review</p>
          <h2 id="round-completion-title">Review and complete round</h2>
        </div>
        <p>Version {version}</p>
      </div>
      <p>
        The preview below is server-authoritative. Optional blank score fields
        are warnings; required inputs and synchronization blockers prevent
        completion.
      </p>
      <div className="round-completion-summary" aria-live="polite">
        <strong>
          {canComplete ? "Ready for confirmation" : "Completion is blocked"}
        </strong>
        <span>
          {preview.participants.length} Playing participant
          {preview.participants.length === 1 ? "" : "s"} · {warnings.length}{" "}
          warning
          {warnings.length === 1 ? "" : "s"}
        </span>
      </div>
      {blockers.length > 0 ? (
        <ReadinessList title="Resolve blockers" rows={blockers} tone="error" />
      ) : null}
      {warnings.length > 0 ? (
        <ReadinessList title="Warnings" rows={warnings} tone="warning" />
      ) : null}
      {preview.mobileSyncCheck !== "complete" ? (
        <p className="form-message error" role="status">
          Mobile score synchronization is not confirmed (
          {preview.mobileSyncCheck}); completion remains blocked.
        </p>
      ) : null}
      <div className="member-results-table-wrap">
        <table className="member-results-table">
          <caption className="visually-hidden">
            Server completion preview for {description}
          </caption>
          <thead>
            <tr>
              <th scope="col">Rank</th>
              <th scope="col">Participant</th>
              <th scope="col">Points</th>
              <th scope="col">Plus/minus</th>
              <th scope="col">Generated merit</th>
            </tr>
          </thead>
          <tbody>
            {preview.participants.map((participant) => (
              <tr key={participant.participantId}>
                <th scope="row">{participant.competitionRank ?? "—"}</th>
                <td>
                  {participant.participantKind === "guest" ? "Guest" : "Member"}{" "}
                  · {participant.participantId}
                </td>
                <td>{participant.golfPoints ?? "Missing"}</td>
                <td>{participant.plusMinus ?? "Not applicable"}</td>
                <td>{participant.merit.generated}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {message ? (
        <p className={`form-message ${messageTone}`} role="status">
          {message}
        </p>
      ) : null}
      <button
        className="primary-button"
        type="button"
        disabled={pending || !canComplete}
        onClick={complete}
      >
        {pending ? "Completing…" : "Confirm completion"}
      </button>
    </section>
  );
}

function RoundReopenPanel({
  roundId,
  description,
  version,
}: Readonly<{
  roundId: string;
  description: string;
  version: number;
}>) {
  const router = useRouter();
  const operationId = useRef<string | null>(null);
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"error" | "success" | "">("");
  const [pending, startTransition] = useTransition();

  function reopen(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setMessageTone("");
    const normalizedReason = reason.trim();
    if (!normalizedReason) {
      setMessage("Add a reason before reopening this round.");
      setMessageTone("error");
      return;
    }
    if (
      !window.confirm(
        `Reopen “${description}”? Generated merit and derived completion outputs will be withdrawn, while history is retained.`,
      )
    ) {
      return;
    }

    operationId.current ??= crypto.randomUUID();
    const parsed = roundReopenInputSchema.safeParse({
      roundId,
      reason: normalizedReason,
      expectedRoundVersion: version,
      confirmed: true,
      operationId: operationId.current,
    });
    if (!parsed.success) {
      setMessage("Refresh the selected round before reopening it.");
      setMessageTone("error");
      return;
    }

    startTransition(async () => {
      let result: Awaited<ReturnType<typeof reopenCompletedRoundAction>>;
      try {
        result = await reopenCompletedRoundAction(parsed.data);
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
      setReason("");
      setMessage(
        "Round reopened. Correct the authoritative inputs before recompleting.",
      );
      setMessageTone("success");
      router.refresh();
    });
  }

  return (
    <section className="group-roles-panel" aria-labelledby="round-reopen-title">
      <div className="group-panel-heading">
        <div>
          <p className="ledger-kicker">Round lifecycle</p>
          <h2 id="round-reopen-title">Reopen completed round</h2>
        </div>
        <p>Version {version}</p>
      </div>
      <p>
        Reopen returns the round to Live for audited correction. Prior score
        revisions and official history remain available for investigation.
      </p>
      <form
        className="group-profile-form"
        onSubmit={reopen}
        noValidate
        aria-busy={pending}
      >
        <label className="field-group" htmlFor="round-reopen-reason">
          <span>Reason</span>
          <textarea
            id="round-reopen-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            maxLength={500}
            rows={3}
            disabled={pending}
            aria-describedby="round-reopen-help"
          />
          <small id="round-reopen-help">
            Required and retained with the reopen audit event (500 characters
            maximum).
          </small>
        </label>
        {message ? (
          <p className={`form-message ${messageTone}`} role="status">
            {message}
          </p>
        ) : null}
        <button className="danger-button" type="submit" disabled={pending}>
          {pending ? "Reopening…" : "Reopen round"}
        </button>
      </form>
    </section>
  );
}

function ReadinessList({
  title,
  rows,
  tone,
}: Readonly<{
  title: string;
  rows: RoundCompletionPreview["readiness"];
  tone: "error" | "warning";
}>) {
  return (
    <div className={`round-readiness-list ${tone}`}>
      <h3>{title}</h3>
      <ul>
        {rows.map((row, index) => (
          <li
            key={`${row.blockerCode ?? row.warningCode ?? row.status}:${row.participantId ?? "round"}:${index}`}
          >
            <strong>
              {readinessLabel(row.blockerCode ?? row.warningCode)}
            </strong>
            {row.participantId ? ` · ${row.participantId}` : ""}
          </li>
        ))}
      </ul>
    </div>
  );
}

function readinessLabel(code: string | null) {
  if (!code) return "Server readiness";
  return code
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
