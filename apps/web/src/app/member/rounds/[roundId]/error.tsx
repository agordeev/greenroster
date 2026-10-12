"use client";

export default function Error({
  unstable_retry,
}: Readonly<{
  error: Error & { digest?: string };
  unstable_retry: () => void;
}>) {
  return (
    <main className="auth-shell auth-shell-single invitation-shell">
      <section className="auth-ledger" aria-labelledby="member-round-error">
        <p className="ledger-kicker">Your round</p>
        <h1 id="member-round-error">This round is unavailable</h1>
        <p>We couldn&apos;t load this round. Try again.</p>
        <button
          className="primary-button"
          type="button"
          onClick={unstable_retry}
        >
          Try again
        </button>
      </section>
    </main>
  );
}
