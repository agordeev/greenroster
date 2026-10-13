"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function BillingEntitlementForm({
  membershipId,
}: Readonly<{ membershipId: string }>) {
  const [open, setOpen] = useState(false);
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
      if (result.ok) setOpen(false);
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

  if (!open) {
    return (
      <div className="grid justify-items-end gap-2 max-[720px]:justify-items-start">
        <Button
          className="justify-self-end max-[720px]:justify-self-start"
          variant="outline"
          type="button"
          onClick={() => setOpen(true)}
        >
          Give access
        </Button>
        {message ? (
          <p
            className="m-0 text-[0.8125rem] text-muted-foreground"
            role="status"
          >
            {message}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <form
      action={submit}
      className="gap-3 grid min-w-0 [&_label]:gap-[0.35rem] [&_label]:grid [&_label]:text-muted-foreground [&_label]:text-[0.75rem] [&_label]:font-bold [&_p[role='status']]:m-0 [&_p[role='status']]:text-muted-foreground [&_p[role='status']]:leading-[1.45]"
    >
      <label>
        Access until
        <Input name="expiresAt" type="datetime-local" required />
      </label>
      <label>
        Reason
        <Input name="reason" maxLength={1000} required />
      </label>
      <div className="flex flex-wrap gap-3">
        <Button type="submit" disabled={busy}>
          {busy ? "Saving…" : "Give access"}
        </Button>
        <Button
          variant="outline"
          type="button"
          disabled={busy}
          onClick={() => setOpen(false)}
        >
          Cancel
        </Button>
      </div>
      {message ? <p role="status">{message}</p> : null}
    </form>
  );
}
