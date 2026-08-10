export default function Loading() {
  return (
    <main
      className="auth-shell auth-shell-single invitation-shell"
      aria-busy="true"
      aria-live="polite"
    >
      <section className="auth-ledger" aria-labelledby="member-round-loading">
        <p className="ledger-kicker">Your round</p>
        <h1 id="member-round-loading">Your round is loading</h1>
        <p>We’re loading your round details.</p>
      </section>
    </main>
  );
}
