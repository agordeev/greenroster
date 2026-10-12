"use client";

import { Button } from "@/components/ui/button";
import { Kicker } from "@/components/blocks";

export default function Error({
  unstable_retry,
}: Readonly<{
  error: Error & { digest?: string };
  unstable_retry: () => void;
}>) {
  return (
    <main className="p-8 min-h-screen grid grid-cols-[minmax(20rem,38rem)] place-content-center max-[800px]:grid-cols-[1fr] max-[480px]:p-0 [&_[data-slot=auth-ledger]]:border [&_[data-slot=auth-ledger]]:min-h-auto [&_[data-slot=auth-ledger]]:w-[min(100%,52rem)] max-[480px]:[&_[data-slot=auth-ledger]]:border-0! max-[480px]:[&_[data-slot=auth-ledger]]:w-full!">
      <section
        className="p-[clamp(2rem,7vw,6rem)] border-r flex min-h-screen flex-col justify-center bg-card max-[800px]:border-r-0 max-[800px]:min-h-auto max-[480px]:p-6 [&>[data-slot=text-link]]:mt-5 [&>[data-slot=text-link]]:inline-block"
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
