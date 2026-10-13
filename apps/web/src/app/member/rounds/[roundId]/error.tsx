"use client";

import { Button } from "@/components/ui/button";
import {
  Kicker,
  standalonePageWideClass,
  standalonePanelClass,
} from "@/components/blocks";

export default function Error({
  unstable_retry,
}: Readonly<{
  error: Error & { digest?: string };
  unstable_retry: () => void;
}>) {
  return (
    <main className={standalonePageWideClass}>
      <section
        className={standalonePanelClass}
        data-slot="auth-ledger"
        aria-labelledby="member-round-error"
      >
        <Kicker>Your round</Kicker>
        <h1 id="member-round-error">This round is unavailable</h1>
        <p>We couldn&apos;t load this round. Try again.</p>
        <Button type="button" onClick={unstable_retry}>
          Try again
        </Button>
      </section>
    </main>
  );
}
