"use client";

import { useState } from "react";

export function BillingEntitlementForm({
  membershipId,
}: Readonly<{ membershipId: string }>) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(formData: FormData) {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/billing/entitlements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          membershipId,
          expiresAt: formData.get("expiresAt"),
          reason: formData.get("reason"),
          operationId: crypto.randomUUID(),
        }),
      });
      const result = (await response.json()) as {
        ok?: boolean;
        error?: { message?: string };
      };
      setMessage(
        result.ok
          ? "Temporary access given."
          : (result.error?.message ?? "We couldn't update access. Try again."),
      );
    } catch {
      setMessage("We couldn't update access. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form action={submit} className="inline-form">
      <label>
        Access until
        <input name="expiresAt" type="datetime-local" required />
      </label>
      <label>
        Reason
        <input name="reason" maxLength={1000} required />
      </label>
      <button className="secondary-button" type="submit" disabled={busy}>
        {busy ? "Saving…" : "Give access"}
      </button>
      {message ? <p role="status">{message}</p> : null}
    </form>
  );
}
