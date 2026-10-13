import { cn } from "cn";
import { portalPanelClass } from "@/components/blocks";
export default function PortalRoundsLoading() {
  return (
    <main className="min-h-[calc(100vh_-_15rem)]">
      <section
        className={cn(portalPanelClass, "min-h-104")}
        aria-busy="true"
        aria-live="polite"
      >
        <h1>Rounds</h1>
        <p>Loading your group’s rounds.</p>
      </section>
    </main>
  );
}
