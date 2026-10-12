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
          Completion check is unavailable
        </h2>
        <p>
          The completion check could not be loaded. Refresh the page before you
          complete this round.
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
        "Fix every blocker and make sure all mobile scores are synced before you complete the round.",
      );
      setMessageTone("error");
      return;
    }
    if (
      !window.confirm(
        `Complete “${description}”? This publishes the official results and updates merit, quotas, and standings.`,
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
      setMessage("Refresh the page, then complete the round again.");
      setMessageTone("error");
      return;
    }

    startTransition(async () => {
      let result: Awaited<ReturnType<typeof completeLiveRoundAction>>;
      try {
        result = await completeLiveRoundAction(parsed.data);
      } catch {
        setMessage("The round wasn't completed. Try again.");
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
        <p>Live round</p>
      </div>
      <p>
        Check the list below. Blank optional scores are warnings. Anything
        marked as a blocker must be fixed before you can complete the round.
      </p>
      <div className="round-completion-summary" aria-live="polite">
        <strong>
          {canComplete ? "Ready for confirmation" : "Completion is blocked"}
        </strong>
        <span>
          {preview.participants.length} playing player
          {preview.participants.length === 1 ? "" : "s"} · {warnings.length}{" "}
          warning
          {warnings.length === 1 ? "" : "s"}
        </span>
      </div>
      <aside
        className="member-results-winner"
        aria-labelledby="round-completion-consequences-title"
      >
        <p className="ledger-kicker">Before you confirm</p>
        <h3 id="round-completion-consequences-title">
          {preview.consequences.winnerCount > 0
            ? `${preview.consequences.winnerCount} winner${preview.consequences.winnerCount === 1 ? "" : "s"}${preview.consequences.winnerIsTie ? " (tied)" : ""}`
            : "No ranked winner yet"}
        </h3>
        <p>
          Completing this round changes{" "}
          {preview.consequences.memberQuotaImpactCount} member quota change
          {preview.consequences.memberQuotaImpactCount === 1
            ? ""
            : "s"} and {preview.consequences.standingImpactCount} standing
          change
          {preview.consequences.standingImpactCount === 1 ? "" : "s"}. Check
          each player below before you confirm.
        </p>
      </aside>
      {blockers.length > 0 ? (
        <ReadinessList title="Fix these first" rows={blockers} tone="error" />
      ) : null}
      {warnings.length > 0 ? (
        <ReadinessList title="Warnings" rows={warnings} tone="warning" />
      ) : null}
      {preview.mobileSyncCheck !== "complete" ? (
        <p className="form-message error" role="status">
          Mobile scores are not synced yet ({preview.mobileSyncCheck}).
          Completion is blocked.
        </p>
      ) : null}
      <div className="member-results-table-wrap">
        <table className="member-results-table">
          <caption className="visually-hidden">
            Completion check for {description}
          </caption>
          <thead>
            <tr>
              <th scope="col">Rank</th>
              <th scope="col">Player</th>
              <th scope="col">Points</th>
              <th scope="col">Plus/minus</th>
              <th scope="col">Quota effect</th>
              <th scope="col">Standing effect</th>
              <th scope="col">Merit earned</th>
            </tr>
          </thead>
          <tbody>
            {preview.participants.map((participant) => (
              <tr key={participant.participantId}>
                <th scope="row">{participant.competitionRank ?? "—"}</th>
                <td>
                  <strong>
                    {participant.participantName || "Unnamed player"}
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
        {pending ? "Completing…" : "Complete round"}
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
        `Reopen “${description}”? Merit and completion results will be removed, but the history stays on record.`,
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
      setMessage("Refresh the page, then reopen the round again.");
      setMessageTone("error");
      return;
    }

    startTransition(async () => {
      let result: Awaited<ReturnType<typeof reopenCompletedRoundAction>>;
      try {
        result = await reopenCompletedRoundAction(parsed.data);
      } catch {
        setMessage("The round wasn't reopened. Try again.");
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
        "Round reopened. Correct the scores, then complete the round again.",
      );
      setMessageTone("success");
      router.refresh();
    });
  }

  return (
    <section className="group-roles-panel" aria-labelledby="round-reopen-title">
      <div className="group-panel-heading">
        <div>
          <p className="ledger-kicker">Completed round</p>
          <h2 id="round-reopen-title">Reopen completed round</h2>
        </div>
        <p>Completed</p>
      </div>
      <p>
        Reopening returns the round to live so you can correct scores. Earlier
        score changes and official results stay in the history.
      </p>
      <aside
        className="member-results-winner"
        aria-labelledby="round-reopen-consequences-title"
      >
        <p className="ledger-kicker">Before you confirm</p>
        <h3 id="round-reopen-consequences-title">
          {winners.length > 0
            ? `${winners.map(displayName).join(" and ")} — ${winners.length > 1 ? "tied " : ""}winner at rank 1`
            : "No ranked winner in the current results"}
        </h3>
        <p>
          This withdraws {officialResults?.results.length ?? "the current"}{" "}
          official{" "}
          {officialResults?.results.length === 1 ? "result" : "results"},
          removes {memberResultCount} member quota history{" "}
          {memberResultCount === 1 ? "entry" : "entries"}, and recalculates
          standings. Guests removed: {guestResultCount}. Result e-mails that
          haven’t gone out are cancelled. Earlier history stays on record.
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
            Required. Kept in the round history. Up to 500 characters.
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
      .trim() || "Unnamed player"
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
  if (!code) return "Round check";
  const words = code.split("_").join(" ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}
