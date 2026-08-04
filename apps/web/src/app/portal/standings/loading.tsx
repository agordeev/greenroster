export default function PortalStandingsLoading() {
  return (
    <main className="portal-main">
      <section className="portal-empty" aria-busy="true" aria-live="polite">
        <p className="ledger-kicker">Competition administration</p>
        <h1>Loading standings</h1>
        <p>Resolving your authenticated group and current Order of Merit.</p>
      </section>
    </main>
  );
}
