"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";

import {
  saveGroupMediaAction,
  saveGroupNewsAction,
} from "@/app/actions/clubhouse";
import {
  EmptyState,
  Field,
  FormMessage,
  SectionHeading,
} from "@/components/blocks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { ClubhouseProjection } from "@/domain/clubhouse-content";

export function ClubhouseAdminPanel({
  initial,
}: Readonly<{ initial: ClubhouseProjection }>) {
  const router = useRouter();
  const [kind, setKind] = useState<"news" | "video">("news");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [url, setUrl] = useState("");
  const [feedback, setFeedback] = useState("");
  const [pending, startTransition] = useTransition();
  const newsOperation = useRef<string | null>(null);
  const mediaOperation = useRef<string | null>(null);
  function saveNews() {
    if (!title.trim() || !body.trim()) {
      setFeedback("Add a title and some news text before you publish.");
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
      router.refresh();
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
      router.refresh();
    });
  }
  const publishedCount = initial.news.length + initial.media.length;

  return (
    <>
      <section
        className="mt-8 max-w-184"
        aria-labelledby="clubhouse-admin-title"
      >
        <h2 className="sr-only" id="clubhouse-admin-title">
          Share something new
        </h2>
        <div className="grid gap-5" data-slot="form-stack">
          <fieldset className="m-0 flex flex-wrap gap-x-6 gap-y-2 border-0 p-0">
            <legend className="mb-2 p-0">What are you sharing?</legend>
            <label>
              <input
                type="radio"
                name="clubhouse-kind"
                checked={kind === "news"}
                onChange={() => setKind("news")}
                disabled={pending}
              />
              News
            </label>
            <label>
              <input
                type="radio"
                name="clubhouse-kind"
                checked={kind === "video"}
                onChange={() => setKind("video")}
                disabled={pending}
              />
              Video link
            </label>
          </fieldset>
          <Field id="clubhouse-title" label="Title">
            <Input
              id="clubhouse-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              disabled={pending}
            />
          </Field>
          {kind === "news" ? (
            <Field id="clubhouse-body" label="News text">
              <Textarea
                id="clubhouse-body"
                value={body}
                onChange={(event) => setBody(event.target.value)}
                maxLength={10000}
                rows={5}
                disabled={pending}
              />
            </Field>
          ) : (
            <Field id="clubhouse-url" label="Video link">
              <Input
                id="clubhouse-url"
                type="url"
                placeholder="https://"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                disabled={pending}
              />
            </Field>
          )}
          <Button
            type="button"
            onClick={kind === "news" ? saveNews : saveMedia}
            disabled={pending}
          >
            {pending
              ? "Saving…"
              : kind === "news"
                ? "Publish news"
                : "Publish video link"}
          </Button>
          <FormMessage role="status">{feedback}</FormMessage>
        </div>
      </section>

      <section
        className="mt-12 border-t pt-8"
        aria-labelledby="clubhouse-published-title"
      >
        <SectionHeading
          title="Published"
          titleId="clubhouse-published-title"
          meta={
            <>
              {publishedCount} {publishedCount === 1 ? "item" : "items"}
            </>
          }
        />
        {publishedCount === 0 ? (
          <EmptyState>
            Nothing published yet. Your members see news and videos here once
            you share them.
          </EmptyState>
        ) : (
          <ul className="m-0 mt-6 grid list-none border-b p-0 [&>li]:grid [&>li]:gap-1 [&>li]:border-t [&>li]:py-4 [&_h3]:m-0 [&_h3]:text-base [&_p]:m-0">
            {initial.news.map((item) => (
              <li key={item.id}>
                <p className="font-mono text-[0.6875rem] font-medium tracking-[0.08em] text-muted-foreground uppercase">
                  News
                </p>
                <h3>{item.title}</h3>
                <p className="line-clamp-2 max-w-168 leading-[1.55] text-muted-foreground">
                  {item.body}
                </p>
              </li>
            ))}
            {initial.media.map((item) => (
              <li key={item.id}>
                <p className="font-mono text-[0.6875rem] font-medium tracking-[0.08em] text-muted-foreground uppercase">
                  Video
                </p>
                <h3>{item.title}</h3>
                <p className="text-[0.875rem] wrap-anywhere text-muted-foreground">
                  {item.mediaUrl}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
