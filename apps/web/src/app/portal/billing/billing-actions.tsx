"use client";

import { useState } from "react";

import { ActionRow } from "@/components/ui";

export function BillingActions({
  hasCustomer,
}: Readonly<{ hasCustomer: boolean }>) {
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<"checkout" | "portal" | null>(null);

  async function open(
    path: "/api/billing/checkout" | "/api/billing/portal",
    kind: "checkout" | "portal",
  ) {
    setBusy(kind);
    setMessage(null);
    try {
      const response = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operationId: crypto.randomUUID() }),
      });
      const result = (await response.json()) as {
        ok?: boolean;
        data?: {
          checkoutUrl?: string | null;
          portalUrl?: string | null;
          processing?: boolean;
        };
        error?: { message?: string };
      };
      if (!response.ok || !result.ok) {
        setMessage(
          result.error?.message ?? "We couldn't open billing. Try again.",
        );
        return;
      }
      const url = result.data?.checkoutUrl ?? result.data?.portalUrl;
      if (url) {
        window.location.assign(url);
      } else {
        setMessage("Refresh this page once your payment has gone through.");
      }
    } catch {
      setMessage("We couldn't open billing. Try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <ActionRow>
      <button
        className="primary-button"
        type="button"
        disabled={busy !== null}
        onClick={() => open("/api/billing/checkout", "checkout")}
      >
        {busy === "checkout" ? "Opening checkout…" : "Start checkout"}
      </button>
      <button
        className="secondary-button"
        type="button"
        disabled={!hasCustomer || busy !== null}
        onClick={() => open("/api/billing/portal", "portal")}
      >
        {busy === "portal" ? "Opening portal…" : "Manage payment"}
      </button>
      {message ? <p role="status">{message}</p> : null}
    </ActionRow>
  );
}
