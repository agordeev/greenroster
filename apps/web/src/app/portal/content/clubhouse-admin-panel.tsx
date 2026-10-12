"use client";

import { useRef, useState, useTransition } from "react";

import {
  saveGroupMediaAction,
  saveGroupNewsAction,
} from "@/app/actions/clubhouse";
import { FormMessage, SectionHeading } from "@/components/blocks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { ClubhouseProjection } from "@/domain/clubhouse-content";

export function ClubhouseAdminPanel({
  initial,
}: Readonly<{ initial: ClubhouseProjection }>) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [url, setUrl] = useState("");
  const [feedback, setFeedback] = useState("");
  const [pending, startTransition] = useTransition();
  const newsOperation = useRef<string | null>(null);
  const mediaOperation = useRef<string | null>(null);
  function saveNews() {
    if (!title.trim() || !body.trim()) {
      setFeedback("Add a title and body before you publish.");
      return;
    }
    newsOperation.current ??= crypto.randomUUID();
    startTransition(async () => {
      const result = await saveGroupNewsAction({
        title,
        body,
        state: "published",
        operationId: newsOperation.current,
      });
      if (!result.ok) {
        setFeedback(result.error.message);
        return;
      }
      setTitle("");
      setBody("");
      newsOperation.current = null;
      setFeedback("News published.");
    });
  }
  function saveMedia() {
    if (!title.trim() || !url.trim()) {
      setFeedback("Add a title and a video link before you publish.");
      return;
    }
    mediaOperation.current ??= crypto.randomUUID();
    startTransition(async () => {
      const result = await saveGroupMediaAction({
        title,
        kind: "external",
        mediaUrl: url,
        state: "published",
        isDefault: false,
        operationId: mediaOperation.current,
      });
      if (!result.ok) {
        setFeedback(result.error.message);
        return;
      }
      setTitle("");
      setUrl("");
      mediaOperation.current = null;
      setFeedback("Video link published.");
    });
  }
  return (
    <section
      className="mt-10 pt-8 border-t [&>h2]:mx-0 [&>h2]:text-[1.5rem] [&>h2]:font-semibold [&>h2]:mt-1.5! [&>h2]:mb-0!"
      aria-labelledby="clubhouse-admin-title"
    >
      <SectionHeading
        kicker="Clubhouse"
        title="Share news and videos"
        titleId="clubhouse-admin-title"
        meta={<>{initial.news.length + initial.media.length} published</>}
      />
      <div
        className="mt-5 gap-5 grid [:where(&)>*]:my-0"
        data-slot="form-stack"
      >
        <label
          className="gap-2 grid [&>label]:text-[0.8125rem] [&>label]:font-bold [&>label]:tracking-[0.015em] [&>span]:text-[0.8125rem] [&>span]:font-bold [&>span]:tracking-[0.015em]"
          data-slot="field"
          htmlFor="clubhouse-title"
        >
          <span>Title</span>
          <Input
            id="clubhouse-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            disabled={pending}
          />
        </label>
        <label
          className="gap-2 grid [&>label]:text-[0.8125rem] [&>label]:font-bold [&>label]:tracking-[0.015em] [&>span]:text-[0.8125rem] [&>span]:font-bold [&>span]:tracking-[0.015em]"
          data-slot="field"
          htmlFor="clubhouse-body"
        >
          <span>News text</span>
          <Textarea
            id="clubhouse-body"
            value={body}
            onChange={(event) => setBody(event.target.value)}
            maxLength={10000}
            rows={5}
            disabled={pending}
          />
        </label>
        <Button type="button" onClick={saveNews} disabled={pending}>
          {pending ? "Saving…" : "Publish news"}
        </Button>
        <label
          className="gap-2 grid [&>label]:text-[0.8125rem] [&>label]:font-bold [&>label]:tracking-[0.015em] [&>span]:text-[0.8125rem] [&>span]:font-bold [&>span]:tracking-[0.015em]"
          data-slot="field"
          htmlFor="clubhouse-url"
        >
          <span>Video link</span>
          <Input
            id="clubhouse-url"
            type="url"
            placeholder="https://"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            disabled={pending}
          />
        </label>
        <Button
          variant="outline"
          type="button"
          onClick={saveMedia}
          disabled={pending}
        >
          Publish video link
        </Button>
        <FormMessage role="status">{feedback}</FormMessage>
      </div>
    </section>
  );
}
