import { Kicker } from "@/components/blocks";
export default function PortalRoundsLoading() {
  return (
    <main className="min-h-[calc(100vh_-_15rem)]">
      <section
        className="mx-auto mt-6 mb-0 p-[clamp(1.5rem,4vw,3rem)] border bg-card max-w-232 min-h-104 max-[480px]:m-0 max-[480px]:border-0 max-[480px]:min-h-[calc(100vh_-_10rem)] [&>p:not([data-slot=kicker])]:max-w-168 [&>p:not([data-slot=kicker])]:text-muted-foreground [&>p:not([data-slot=kicker])]:leading-[1.65] [&_form]:mt-8 [&_h1]:mx-0 [&_h1]:mt-2.5 [&_h1]:mb-4 [&_h1]:text-[length:clamp(1.75rem,3vw,2.5rem)] [&_h1]:font-semibold [&_h1]:tracking-[-0.02em] [&_h1]:leading-[1.1]"
        aria-busy="true"
        aria-live="polite"
      >
        <Kicker>Your group</Kicker>
        <h1>Rounds</h1>
        <p>Loading your group’s rounds.</p>
      </section>
    </main>
  );
}
