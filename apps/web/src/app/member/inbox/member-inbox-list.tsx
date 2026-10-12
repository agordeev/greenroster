"use client";

import { useRef, useState, useTransition } from "react";

import { markMemberInboxReadAction } from "@/app/actions/notifications";
import type { MemberInboxItem } from "@/domain/member-inbox";

export function MemberInboxList({
  initialItems,
}: Readonly<{ initialItems: readonly MemberInboxItem[] }>) {
  const [items, setItems] = useState(() => [...initialItems]);
  const [message, setMessage] = useState("");
  const [pendingItemId, setPendingItemId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const operationIds = useRef(new Map<string, string>());

  function markRead(item: MemberInboxItem) {
    if (item.readAt || pending) return;
    const operationId =
      operationIds.current.get(item.inboxItemId) ?? crypto.randomUUID();
    operationIds.current.set(item.inboxItemId, operationId);
    setMessage("");
    setPendingItemId(item.inboxItemId);
    startTransition(async () => {
      let result: Awaited<ReturnType<typeof markMemberInboxReadAction>>;
      try {
        result = await markMemberInboxReadAction({
          inboxItemId: item.inboxItemId,
          operationId,
        });
      } catch {
        setMessage("We could not mark that update. Try again.");
        setPendingItemId(null);
        return;
      }
      if (!result.ok) {
        setMessage(result.error.message);
        if (result.error.code === "operation_reused") {
          operationIds.current.delete(item.inboxItemId);
        }
        setPendingItemId(null);
        return;
      }
      setItems((current) =>
        current.map((currentItem) =>
          currentItem.inboxItemId === item.inboxItemId
            ? { ...currentItem, readAt: result.data.readAt }
            : currentItem,
        ),
      );
      setPendingItemId(null);
      setMessage("Marked as read.");
    });
  }

  if (items.length === 0) {
    return (
      <p className="member-read-empty" role="status">
        You have no round updates yet.
      </p>
    );
  }

  return (
    <>
      {message ? (
        <p className="form-message" role="status">
          {message}
        </p>
      ) : null}
      <div className="member-inbox-list">
        {items.map((item) => (
          <article
            className={`member-inbox-item${item.readAt ? "" : " member-inbox-item-unread"}`}
            key={item.inboxItemId}
          >
            <div className="member-inbox-item-heading">
              <div>
                <p className="ledger-kicker">
                  {item.readAt
                    ? "You have opened this update"
                    : "You have a new update"}
                </p>
                <h2>{item.roundDescription ?? "Your round"}</h2>
              </div>
              <time dateTime={item.createdAt}>
                {formatInboxTimestamp(item.createdAt)}
              </time>
            </div>
            <p>{item.body}</p>
            <p className="member-inbox-author">
              {item.authorDisplayName} · {formatRole(item.authorRole)}
            </p>
            {!item.readAt ? (
              <button
                className="secondary-button"
                type="button"
                onClick={() => markRead(item)}
                disabled={pending}
              >
                {pendingItemId === item.inboxItemId
                  ? "Saving…"
                  : "Mark as read"}
              </button>
            ) : null}
          </article>
        ))}
      </div>
    </>
  );
}

function formatInboxTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function formatRole(role: MemberInboxItem["authorRole"]) {
  return role === "administrator"
    ? "Administrator"
    : role === "coordinator"
      ? "Coordinator"
      : "Member";
}
