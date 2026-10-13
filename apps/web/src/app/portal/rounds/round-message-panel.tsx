"use client";

import { useRef, useState, useTransition } from "react";

import { postRoundMessageAction } from "@/app/actions/clubhouse";
import { FormMessage, SectionHeading } from "@/components/blocks";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
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
      setFeedback("Write a message before you post.");
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
      setFeedback("Message posted.");
    });
  }
  return (
    <section
      className="mt-10 pt-8 border-t [&>h2]:mx-0 [&>h2]:text-[1.5rem] [&>h2]:font-semibold [&>h2]:mt-1.5! [&>h2]:mb-0!"
      aria-labelledby="round-message-title"
    >
      <SectionHeading
        kicker="Round conversation"
        title="Messages for this round"
        titleId="round-message-title"
        meta={String(messages.length)}
      />
      <div className="mt-8 gap-4 grid">
        {messages.map((message) => (
          <article
            className="p-5 gap-3 border grid rounded-lg [&>p]:m-0 [&>p]:leading-[1.6] [&_[data-slot='button']]:justify-self-start"
            key={message.messageId}
          >
            <p>{message.body ?? "This message was removed."}</p>
            <p className="text-muted-foreground text-[0.8125rem]">
              {message.authorDisplayName} · {message.authorRole}
            </p>
          </article>
        ))}
      </div>
      <label
        className="gap-2 grid [&>label]:text-[0.8125rem] [&>label]:font-bold [&>label]:tracking-[0.015em] [&>span]:text-[0.8125rem] [&>span]:font-bold [&>span]:tracking-[0.015em]"
        data-slot="field"
        htmlFor="round-message-body"
      >
        <span>Write a message</span>
        <Textarea
          id="round-message-body"
          value={body}
          maxLength={300}
          onChange={(event) => setBody(event.target.value)}
          disabled={pending}
          rows={3}
        />
      </label>
      <p
        className="m-0 min-h-5 text-[0.8125rem] leading-[1.45] text-muted-foreground [&_a]:text-primary [&_a]:font-bold [&_a]:underline [&_a]:underline-offset-[0.2em]"
        aria-live="polite"
      >
        {300 - body.length} characters left.
      </p>
      <Button type="button" onClick={submit} disabled={pending}>
        {pending ? "Posting…" : "Post message"}
      </Button>
      {feedback ? <FormMessage role="status">{feedback}</FormMessage> : null}
    </section>
  );
}
