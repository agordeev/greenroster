"use client";

import { useRef, useState, useTransition } from "react";

import {
  createScoreboardAccessAction,
  revokeScoreboardAccessAction,
} from "@/app/actions/scoreboard";
import type { ScoreboardAccessGrant } from "@/lib/scoreboard/scoreboard-access";

export function ScoreboardAccessPanel({
  roundId,
}: Readonly<{ roundId: string }>) {
  const createOperationId = useRef<string | null>(null);
  const revokeOperationId = useRef<string | null>(null);
  const [expiresAt, setExpiresAt] = useState("");
  const [reason, setReason] = useState("");
  const [grant, setGrant] = useState<ScoreboardAccessGrant | null>(null);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"error" | "success" | "">("");
  const [pending, startTransition] = useTransition();

  function issueLink() {
    setMessage("");
    setMessageTone("");
    const expiry = new Date(expiresAt);
    if (!expiresAt || Number.isNaN(expiry.getTime()) || expiry <= new Date()) {
      setMessage("Choose a future time before you share this round.");
      setMessageTone("error");
      return;
    }
    createOperationId.current ??= crypto.randomUUID();
    startTransition(async () => {
      let result: Awaited<ReturnType<typeof createScoreboardAccessAction>>;
      try {
        result = await createScoreboardAccessAction({
          roundId,
          expiresAt: expiry.toISOString(),
          operationId: createOperationId.current,
        });
      } catch {
        setMessage("You can't share this round right now. Try again.");
        setMessageTone("error");
        return;
      }
      if (!result.ok) {
        setMessage(result.error.message);
        setMessageTone("error");
        if (result.error.code === "operation_reused")
          createOperationId.current = null;
        return;
      }
      createOperationId.current = null;
      setGrant(result.data);
      setMessage(
        "You can share this live-scores link until the time you chose.",
      );
      setMessageTone("success");
    });
  }

  function revokeLink() {
    if (!grant || !window.confirm("Stop sharing this live-scores link?"))
      return;
    const normalizedReason = reason.trim();
    if (!normalizedReason) {
      setMessage("Add a reason before you stop sharing this link.");
      setMessageTone("error");
      return;
    }
    revokeOperationId.current ??= crypto.randomUUID();
    startTransition(async () => {
      let result: Awaited<ReturnType<typeof revokeScoreboardAccessAction>>;
      try {
        result = await revokeScoreboardAccessAction({
          accessId: grant.accessId,
          reason: normalizedReason,
          operationId: revokeOperationId.current,
        });
      } catch {
        setMessage("You can't stop sharing this link right now. Try again.");
        setMessageTone("error");
        return;
      }
      if (!result.ok) {
        setMessage(result.error.message);
        setMessageTone("error");
        if (result.error.code === "operation_reused")
          revokeOperationId.current = null;
        return;
      }
      revokeOperationId.current = null;
      setGrant(null);
      setMessage("You stopped sharing this live-scores link.");
      setMessageTone("success");
    });
  }

  async function copyLink() {
    if (!grant?.url) return;
    try {
      await navigator.clipboard.writeText(grant.url);
      setMessage("You copied the live-scores link.");
      setMessageTone("success");
    } catch {
      setMessage("You can copy the link from the field above.");
      setMessageTone("error");
    }
  }

  return (
    <section
      className="group-roles-panel"
      aria-labelledby="scoreboard-access-title"
    >
      <div className="group-panel-heading">
        <div>
          <p className="ledger-kicker">Live scores</p>
          <h2 id="scoreboard-access-title">Share this round</h2>
        </div>
      </div>
      <p>
        You can share a read-only link for a clubhouse screen or guest browser.
      </p>
      {grant?.url ? (
        <div className="group-profile-form">
          <label className="field-group" htmlFor="scoreboard-access-url">
            <span>Live-scores link</span>
            <input id="scoreboard-access-url" value={grant.url} readOnly />
          </label>
          <p className="form-help">Copy this link while it’s active.</p>
          <button
            className="secondary-button"
            type="button"
            onClick={copyLink}
            disabled={pending}
          >
            Copy link
          </button>
          <label className="field-group" htmlFor="scoreboard-revoke-reason">
            <span>Why are you stopping sharing?</span>
            <input
              id="scoreboard-revoke-reason"
              value={reason}
              maxLength={500}
              onChange={(event) => setReason(event.target.value)}
              disabled={pending}
            />
          </label>
          <button
            className="danger-button"
            type="button"
            onClick={revokeLink}
            disabled={pending}
          >
            {pending ? "Stopping sharing…" : "Stop sharing"}
          </button>
        </div>
      ) : (
        <div className="group-profile-form" aria-busy={pending}>
          <label className="field-group" htmlFor="scoreboard-access-expires-at">
            <span>Stop sharing at</span>
            <input
              id="scoreboard-access-expires-at"
              type="datetime-local"
              value={expiresAt}
              onChange={(event) => setExpiresAt(event.target.value)}
              disabled={pending}
              required
            />
          </label>
          <p className="form-help">Choose when this link stops working.</p>
          <button
            className="primary-button"
            type="button"
            onClick={issueLink}
            disabled={pending}
          >
            {pending ? "Creating link…" : "Create live-scores link"}
          </button>
        </div>
      )}
      {message ? (
        <p className={`form-message ${messageTone}`} role="status">
          {message}
        </p>
      ) : null}
    </section>
  );
}
