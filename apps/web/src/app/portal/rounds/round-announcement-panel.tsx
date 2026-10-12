"use client";

import { useRef, useState, useTransition } from "react";

import { postRoundAnnouncementAction } from "@/app/actions/rounds";
import { SectionHeading } from "@/components/ui";
import { roundAnnouncementInputSchema } from "@/domain/round-announcement";

export function RoundAnnouncementPanel({
  roundId,
}: Readonly<{ roundId: string }>) {
  const operationId = useRef<string | null>(null);
  const [body, setBody] = useState("");
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"error" | "success" | "">("");
  const [pending, startTransition] = useTransition();

  function postUpdate() {
    setMessage("");
    setMessageTone("");
    operationId.current ??= crypto.randomUUID();
    const parsed = roundAnnouncementInputSchema.safeParse({
      roundId,
      body,
      operationId: operationId.current,
    });
    if (!parsed.success) {
      setMessage(
        parsed.error.issues[0]?.message ??
          "Keep your update to 300 characters or fewer.",
      );
      setMessageTone("error");
      return;
    }

    startTransition(async () => {
      let result: Awaited<ReturnType<typeof postRoundAnnouncementAction>>;
      try {
        result = await postRoundAnnouncementAction(parsed.data);
      } catch {
        setMessage("You can't post this update right now. Try again.");
        setMessageTone("error");
        return;
      }
      if (!result.ok) {
        setMessage(result.error.message);
        setMessageTone("error");
        if (result.error.code === "operation_reused")
          operationId.current = null;
        return;
      }
      operationId.current = null;
      setBody("");
      setMessage("Your update is posted to this round.");
      setMessageTone("success");
    });
  }

  const remaining = Math.max(0, 300 - body.length);

  return (
    <section
      className="page-section"
      aria-labelledby="round-announcement-title"
    >
      <SectionHeading
        kicker="Round updates"
        title="Post an update"
        titleId="round-announcement-title"
        meta={<>{remaining} characters left.</>}
      />
      <p>Post a short update for everyone in this round.</p>
      {message ? (
        <p className={`form-message ${messageTone}`} role="status">
          {message}
        </p>
      ) : null}
      <div className="form-stack" aria-busy={pending}>
        <label htmlFor="round-announcement-body">Your update</label>
        <textarea
          id="round-announcement-body"
          value={body}
          maxLength={300}
          onChange={(event) => setBody(event.target.value)}
          rows={4}
          aria-describedby="round-announcement-help"
          disabled={pending}
        />
        <p id="round-announcement-help" className="form-help">
          Up to 300 characters.
        </p>
        <button
          className="primary-button"
          type="button"
          disabled={pending || body.trim().length === 0}
          onClick={postUpdate}
        >
          {pending ? "Posting update…" : "Post update"}
        </button>
      </div>
    </section>
  );
}
