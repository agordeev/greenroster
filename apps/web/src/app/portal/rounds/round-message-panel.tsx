"use client";

import { useRef, useState, useTransition } from "react";

import { postRoundMessageAction } from "@/app/actions/clubhouse";
import { SectionHeading } from "@/components/ui";
import type { RoundMessage } from "@/domain/clubhouse-content";

export function RoundMessagePanel({
  roundId,
  initialMessages,
}: Readonly<{ roundId: string; initialMessages: readonly RoundMessage[] }>) {
  const [messages, setMessages] = useState(() => [...initialMessages]);
  const [body, setBody] = useState("");
  const [feedback, setFeedback] = useState("");
  const [pending, startTransition] = useTransition();
  const operationId = useRef<string | null>(null);
  function submit() {
    const normalized = body.trim();
    if (!normalized || normalized.length > 300 || pending) {
      setFeedback(
        "Write a message before you post. It can be up to 300 characters.",
      );
      return;
    }
    operationId.current ??= crypto.randomUUID();
    startTransition(async () => {
      const result = await postRoundMessageAction({
        roundId,
        body: normalized,
        operationId: operationId.current,
      });
      if (!result.ok) {
        setFeedback(result.error.message);
        if (result.error.code === "operation_reused")
          operationId.current = null;
        return;
      }
      setMessages((current) => [
        ...current,
        {
          messageId: String(result.data.message_id ?? crypto.randomUUID()),
          groupId: String(result.data.group_id ?? ""),
          roundId,
          authorDisplayName: "You",
          authorRole: "member",
          body: normalized,
          createdAt: new Date().toISOString(),
          removedAt: null,
          removalReason: null,
        },
      ]);
      setBody("");
      operationId.current = null;
      setFeedback("You posted your message.");
    });
  }
  return (
    <section className="page-section" aria-labelledby="round-message-title">
      <SectionHeading
        kicker="Round conversation"
        title="Messages for this round"
        titleId="round-message-title"
        meta={String(messages.length)}
      />
      <div className="member-inbox-list">
        {messages.map((message) => (
          <article className="member-inbox-item" key={message.messageId}>
            <p>{message.body ?? "This message was removed."}</p>
            <p className="member-inbox-author">
              {message.authorDisplayName} · {message.authorRole}
            </p>
          </article>
        ))}
      </div>
      <label className="field-group" htmlFor="round-message-body">
        <span>Write a message</span>
        <textarea
          id="round-message-body"
          value={body}
          maxLength={300}
          onChange={(event) => setBody(event.target.value)}
          disabled={pending}
          rows={3}
        />
      </label>
      <p className="form-help" aria-live="polite">
        {300 - body.length} characters left.
      </p>
      <button
        className="primary-button"
        type="button"
        onClick={submit}
        disabled={pending}
      >
        {pending ? "Posting…" : "Post message"}
      </button>
      {feedback ? (
        <p className="form-message" role="status">
          {feedback}
        </p>
      ) : null}
    </section>
  );
}
