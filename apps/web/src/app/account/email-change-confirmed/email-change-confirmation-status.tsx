"use client";

import { useEffect, useSyncExternalStore } from "react";

import {
  resolveEmailChangeConfirmation,
  shouldScrubEmailChangeConfirmation,
} from "@/lib/auth/email-change-confirmation";

export function EmailChangeConfirmationStatus() {
  const location = useSyncExternalStore(
    () => () => undefined,
    () => `${window.location.search}\0${window.location.hash}`,
    () => "\0",
  );
  const [search, hash] = location.split("\0", 2);
  const result = resolveEmailChangeConfirmation(search ?? "", hash ?? "");

  useEffect(() => {
    if (!shouldScrubEmailChangeConfirmation(search ?? "", hash ?? "")) return;
    window.history.replaceState(
      window.history.state,
      "",
      window.location.pathname,
    );
  }, [hash, search]);

  return (
    <p aria-live="polite" data-status={result.status}>
      {result.message}
    </p>
  );
}
