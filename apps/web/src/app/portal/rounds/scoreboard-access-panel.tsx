"use client";

import { useRef, useState, useTransition } from "react";

import {
  createScoreboardAccessAction,
  revokeScoreboardAccessAction,
} from "@/app/actions/scoreboard";
import { FormMessage, SectionHeading } from "@/components/blocks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
    <section
      className="mt-10 pt-8 border-t [&>h2]:mx-0 [&>h2]:text-[1.5rem] [&>h2]:font-semibold [&>h2]:mt-1.5! [&>h2]:mb-0!"
      aria-labelledby="scoreboard-access-title"
    >
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
        <div
          className="mt-5 gap-5 grid [:where(&)>*]:my-0"
          data-slot="form-stack"
        >
          <label
            className="gap-2 grid [&>label]:text-[0.8125rem] [&>label]:font-bold [&>label]:tracking-[0.015em] [&>span]:text-[0.8125rem] [&>span]:font-bold [&>span]:tracking-[0.015em]"
            data-slot="field"
            htmlFor="scoreboard-access-url"
          >
            <span>Live-scores link</span>
            <Input id="scoreboard-access-url" value={grant.url} readOnly />
          </label>
          <p className="m-0 min-h-5 text-[0.8125rem] leading-[1.45] text-muted-foreground [&_a]:text-primary [&_a]:font-bold [&_a]:underline [&_a]:underline-offset-[0.2em]">
            Copy this link while it’s active.
          </p>
          <Button
            variant="outline"
            type="button"
            onClick={copyLink}
            disabled={pending}
          >
            Copy link
          </Button>
          <label
            className="gap-2 grid [&>label]:text-[0.8125rem] [&>label]:font-bold [&>label]:tracking-[0.015em] [&>span]:text-[0.8125rem] [&>span]:font-bold [&>span]:tracking-[0.015em]"
            data-slot="field"
            htmlFor="scoreboard-revoke-reason"
          >
            <span>Reason for stopping</span>
            <Input
              id="scoreboard-revoke-reason"
              value={reason}
              maxLength={500}
              onChange={(event) => setReason(event.target.value)}
              disabled={pending}
            />
          </label>
          <Button
            variant="destructive"
            type="button"
            onClick={revokeLink}
            disabled={pending}
          >
            {pending ? "Stopping sharing…" : "Stop sharing"}
          </Button>
        </div>
      ) : (
        <div
          className="mt-5 gap-5 grid [:where(&)>*]:my-0"
          data-slot="form-stack"
          aria-busy={pending}
        >
          <label
            className="gap-2 grid [&>label]:text-[0.8125rem] [&>label]:font-bold [&>label]:tracking-[0.015em] [&>span]:text-[0.8125rem] [&>span]:font-bold [&>span]:tracking-[0.015em]"
            data-slot="field"
            htmlFor="scoreboard-access-expires-at"
          >
            <span>Link works until</span>
            <Input
              id="scoreboard-access-expires-at"
              type="datetime-local"
              value={expiresAt}
              onChange={(event) => setExpiresAt(event.target.value)}
              disabled={pending}
              required
            />
          </label>
          <p className="m-0 min-h-5 text-[0.8125rem] leading-[1.45] text-muted-foreground [&_a]:text-primary [&_a]:font-bold [&_a]:underline [&_a]:underline-offset-[0.2em]">
            Choose when this link stops working.
          </p>
          <Button type="button" onClick={issueLink} disabled={pending}>
            {pending ? "Creating link…" : "Create live-scores link"}
          </Button>
        </div>
      )}
      {message ? (
        <FormMessage
          tone={messageTone === "success" ? "success" : "error"}
          role="status"
        >
          {message}
        </FormMessage>
      ) : null}
    </section>
  );
}
