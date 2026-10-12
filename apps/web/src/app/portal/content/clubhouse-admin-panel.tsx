"use client";

import { useRef, useState, useTransition } from "react";

import {
  saveGroupMediaAction,
  saveGroupNewsAction,
} from "@/app/actions/clubhouse";
import { SectionHeading } from "@/components/ui";
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
      setFeedback("You published your news.");
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
      setFeedback("You published your video link.");
    });
  }
  return (
    <section className="page-section" aria-labelledby="clubhouse-admin-title">
      <SectionHeading
        kicker="Clubhouse"
        title="Share news and videos"
        titleId="clubhouse-admin-title"
        meta={<>{initial.news.length + initial.media.length} published</>}
      />
      <div className="form-stack">
        <label className="field-group" htmlFor="clubhouse-title">
          <span>Title</span>
          <input
            id="clubhouse-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            disabled={pending}
          />
        </label>
        <label className="field-group" htmlFor="clubhouse-body">
          <span>News body</span>
          <textarea
            id="clubhouse-body"
            value={body}
            onChange={(event) => setBody(event.target.value)}
            maxLength={10000}
            rows={5}
            disabled={pending}
          />
        </label>
        <button
          className="primary-button"
          type="button"
          onClick={saveNews}
          disabled={pending}
        >
          {pending ? "Saving…" : "Publish news"}
        </button>
        <label className="field-group" htmlFor="clubhouse-url">
          <span>Video link</span>
          <input
            id="clubhouse-url"
            type="url"
            placeholder="https://"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            disabled={pending}
          />
        </label>
        <button
          className="secondary-button"
          type="button"
          onClick={saveMedia}
          disabled={pending}
        >
          Publish video link
        </button>
        <p className="form-message" role="status">
          {feedback}
        </p>
      </div>
    </section>
  );
}
