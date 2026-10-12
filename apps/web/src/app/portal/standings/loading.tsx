export default function PortalStandingsLoading() {
  return (
    <main className="portal-main">
      <section className="portal-empty" aria-busy="true" aria-live="polite">
        <p className="ledger-kicker">Order of Merit</p>
        <h1>Standings</h1>
        <p>Loading the current Order of Merit.</p>
      </section>
    </main>
  );
}
