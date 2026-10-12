export default function Loading() {
  return (
    <main
      className="auth-shell auth-shell-single invitation-shell"
      aria-busy="true"
      aria-live="polite"
    >
      <section className="auth-ledger" aria-labelledby="member-round-loading">
        <p className="ledger-kicker">Your round</p>
        <h1 id="member-round-loading">Loading your round</h1>
        <p>One moment.</p>
      </section>
    </main>
  );
}
