export default function PortalRoundsLoading() {
  return (
    <main className="portal-main">
      <section className="portal-empty" aria-busy="true" aria-live="polite">
        <p className="ledger-kicker">Round administration</p>
        <h1>Loading rounds</h1>
        <p>
          Resolving your authenticated group and server-confirmed round state.
        </p>
      </section>
    </main>
  );
}
