import Link from "next/link";

import { ActionRow } from "@/components/blocks";
import { Button } from "@/components/ui/button";
import { InformationShell } from "@/app/information-shell";

export default function HomePage() {
  return (
    <InformationShell kicker="Home" title="Your group, rounds, and roster">
      <div className="information-copy">
        <p>
          Sign in to see your next round, recent results, and where you stand.
          Coordinators and administrators also run the group from the portal.
        </p>
        <ActionRow>
          <Button asChild>
            <Link href="/sign-in">Open GreenRoster</Link>
          </Button>
          <Link className="secondary-link" href="/help">
            Read help
          </Link>
        </ActionRow>
      </div>
    </InformationShell>
  );
}
