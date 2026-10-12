"use client";

import { useRef, useState, useTransition } from "react";

import { postRoundAnnouncementAction } from "@/app/actions/rounds";
import { FormMessage, SectionHeading } from "@/components/blocks";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
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
        setMessage("We couldn't post your update. Try again.");
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
      className="mt-10 pt-8 border-t [&>h2]:mx-0 [&>h2]:text-[1.5rem] [&>h2]:font-semibold [&>h2]:mt-1.5! [&>h2]:mb-0!"
      aria-labelledby="round-announcement-title"
    >
      <SectionHeading
        kicker="Round updates"
        title="Post an update"
        titleId="round-announcement-title"
        meta={<>{remaining} characters left.</>}
      />
      {message ? (
        <FormMessage
          tone={messageTone === "success" ? "success" : "error"}
          role="status"
        >
          {message}
        </FormMessage>
      ) : null}
      <div
        className="mt-5 gap-5 grid [:where(&)>*]:my-0"
        data-slot="form-stack"
        aria-busy={pending}
      >
        <label htmlFor="round-announcement-body">Your update</label>
        <Textarea
          id="round-announcement-body"
          value={body}
          maxLength={300}
          onChange={(event) => setBody(event.target.value)}
          rows={4}
          aria-describedby="round-announcement-help"
          disabled={pending}
        />
        <p
          id="round-announcement-help"
          className="m-0 min-h-5 text-[0.8125rem] leading-[1.45] text-muted-foreground [&_a]:text-primary [&_a]:font-bold [&_a]:underline [&_a]:underline-offset-[0.2em]"
        >
          Up to 300 characters.
        </p>
        <Button
          type="button"
          disabled={pending || body.trim().length === 0}
          onClick={postUpdate}
        >
          {pending ? "Posting update…" : "Post update"}
        </Button>
      </div>
    </section>
  );
}
