export default function PortalRoundsLoading() {
  return (
    <main className="portal-main">
      <section className="portal-empty" aria-busy="true" aria-live="polite">
        <p className="ledger-kicker">Your group</p>
        <h1>Rounds</h1>
        <p>Loading your group’s rounds.</p>
      </section>
    </main>
  );
}
