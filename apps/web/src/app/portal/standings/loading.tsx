import { cn } from "cn";
import { Kicker, portalPanelClass } from "@/components/blocks";
export default function PortalStandingsLoading() {
  return (
    <main className="min-h-[calc(100vh_-_15rem)]">
      <section
        className={cn(portalPanelClass, "min-h-104")}
        aria-busy="true"
        aria-live="polite"
      >
        <Kicker>Order of Merit</Kicker>
        <h1>Standings</h1>
        <p>Loading the current Order of Merit.</p>
      </section>
    </main>
  );
}
