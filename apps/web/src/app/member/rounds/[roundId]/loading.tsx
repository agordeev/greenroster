import {
  Kicker,
  standalonePageWideClass,
  standalonePanelClass,
} from "@/components/blocks";
export default function Loading() {
  return (
    <main
      className={standalonePageWideClass}
      aria-busy="true"
      aria-live="polite"
    >
      <section
        className={standalonePanelClass}
        data-slot="auth-ledger"
        aria-labelledby="member-round-loading"
      >
        <Kicker>Your round</Kicker>
        <h1 id="member-round-loading">Loading your round</h1>
        <p>One moment.</p>
      </section>
    </main>
  );
}
