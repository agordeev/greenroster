"use client";

import { useRef, useState, useTransition } from "react";

import {
  createScoreboardAccessAction,
  revokeScoreboardAccessAction,
} from "@/app/actions/scoreboard";
import { SectionHeading } from "@/components/ui";
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
      setMessage("Choose a time in the future.");
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
        setMessage("We couldn't create the link. Try again.");
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
      setMessage("Your live-scores link is ready.");
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
        setMessage("We couldn't stop sharing this link. Try again.");
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
      setMessage("This live-scores link no longer works.");
      setMessageTone("success");
    });
  }

  async function copyLink() {
    if (!grant?.url) return;
    try {
      await navigator.clipboard.writeText(grant.url);
      setMessage("Link copied.");
      setMessageTone("success");
    } catch {
      setMessage("We couldn't copy the link. Copy it from the field above.");
      setMessageTone("error");
    }
  }

  return (
    <section className="page-section" aria-labelledby="scoreboard-access-title">
      <SectionHeading
        kicker="Live scores"
        title="Share this round"
        titleId="scoreboard-access-title"
      />
      <p>
        Share a view-only link to show live scores on a clubhouse screen or with
        guests.
      </p>
      {grant?.url ? (
        <div className="form-stack">
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
            <span>Reason for stopping</span>
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
        <div className="form-stack" aria-busy={pending}>
          <label className="field-group" htmlFor="scoreboard-access-expires-at">
            <span>Link works until</span>
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
