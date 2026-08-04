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
import type {
  MemberOfficialResult,
  MemberOfficialRound,
} from "@/lib/rounds/member-results-data";

export function RoundCompletionPanel({
  roundId,
  description,
  state,
  version,
  preview,
  unavailable,
  officialResults,
}: Readonly<{
  roundId: string;
  description: string;
  state: "live" | "completed";
  version: number;
  preview: RoundCompletionPreview | null;
  unavailable: boolean;
  officialResults: Readonly<{
    round: MemberOfficialRound;
    results: readonly MemberOfficialResult[];
  }> | null;
}>) {
  if (state === "completed") {
    return (
      <RoundReopenPanel
        roundId={roundId}
        description={description}
        version={version}
        officialResults={officialResults}
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
      <aside
        className="member-results-winner"
        aria-labelledby="round-completion-consequences-title"
      >
        <p className="ledger-kicker">Before confirmation</p>
        <h3 id="round-completion-consequences-title">
          {preview.consequences.winnerCount > 0
            ? `${preview.consequences.winnerCount} winner${preview.consequences.winnerCount === 1 ? "" : "s"}${preview.consequences.winnerIsTie ? " (tied)" : ""}`
            : "No ranked winner yet"}
        </h3>
        <p>
          Server projection: {preview.consequences.memberQuotaImpactCount}{" "}
          member quota change
          {preview.consequences.memberQuotaImpactCount === 1
            ? ""
            : "s"} and {preview.consequences.standingImpactCount} standing
          change
          {preview.consequences.standingImpactCount === 1 ? "" : "s"}. Review
          each participant below before confirming.
        </p>
      </aside>
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
              <th scope="col">Quota effect</th>
              <th scope="col">Standing effect</th>
              <th scope="col">Generated merit</th>
            </tr>
          </thead>
          <tbody>
            {preview.participants.map((participant) => (
              <tr key={participant.participantId}>
                <th scope="row">{participant.competitionRank ?? "—"}</th>
                <td>
                  <strong>
                    {participant.participantName || "Unnamed participant"}
                  </strong>
                  {participant.participantKind === "guest" ? (
                    <span className="member-results-guest">Guest</span>
                  ) : null}
                  {participant.isWinner ? (
                    <small className="member-results-meta">
                      {participant.winnerTieSize > 1 ? "Tied winner" : "Winner"}
                    </small>
                  ) : null}
                </td>
                <td>{participant.golfPoints ?? "Missing"}</td>
                <td>{participant.plusMinus ?? "Not applicable"}</td>
                <td>
                  {participant.participantKind === "guest"
                    ? "Not applicable"
                    : `${participant.quotaBefore ?? "—"} → ${participant.quotaAfter ?? "—"}`}
                </td>
                <td>
                  {participant.participantKind === "guest"
                    ? "Not applicable"
                    : formatStandingEffect(
                        participant.standingBefore,
                        participant.standingAfter,
                        participant.standingDelta,
                      )}
                </td>
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
  officialResults,
}: Readonly<{
  roundId: string;
  description: string;
  version: number;
  officialResults: Readonly<{
    round: MemberOfficialRound;
    results: readonly MemberOfficialResult[];
  }> | null;
}>) {
  const router = useRouter();
  const operationId = useRef<string | null>(null);
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"error" | "success" | "">("");
  const [pending, startTransition] = useTransition();
  const memberResultCount =
    officialResults?.results.filter((result) => result.membership_id !== null)
      .length ?? 0;
  const guestResultCount =
    officialResults?.results.filter((result) => result.membership_id === null)
      .length ?? 0;
  const winners =
    officialResults?.results.filter(
      (result) => result.competition_rank === 1,
    ) ?? [];

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
      <aside
        className="member-results-winner"
        aria-labelledby="round-reopen-consequences-title"
      >
        <p className="ledger-kicker">Before confirmation</p>
        <h3 id="round-reopen-consequences-title">
          {winners.length > 0
            ? `${winners.map(displayName).join(" and ")} — ${winners.length > 1 ? "tied " : ""}winner at rank 1`
            : "No ranked winner in the current snapshot"}
        </h3>
        <p>
          This withdraws {officialResults?.results.length ?? "the current"}{" "}
          official result row
          {officialResults?.results.length === 1 ? "" : "s"}, removes{" "}
          {memberResultCount} member quota history row
          {memberResultCount === 1 ? "" : "s"}, and recalculates standings.
          Guest rows withdrawn: {guestResultCount}. Queued result notifications
          are cancelled by the server; prior audit/history remains available.
        </p>
      </aside>
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

function formatStandingEffect(
  before: number | null,
  after: number | null,
  delta: number | null,
) {
  if (before === null && after === null) return "Unranked";
  if (before === null) return `Unranked → ${after}`;
  if (after === null) return `${before} → Unranked`;
  if (delta === null) return `${before} → ${after}`;
  if (delta === 0) return `${before} → ${after} (unchanged)`;
  return `${before} → ${after} (${delta > 0 ? "up" : "down"} ${Math.abs(delta)})`;
}

function displayName(result: MemberOfficialResult) {
  return (
    [result.first_name, result.last_name]
      .filter((value): value is string => Boolean(value?.trim()))
      .join(" ")
      .trim() || "Unnamed participant"
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
