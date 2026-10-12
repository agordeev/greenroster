import Link from "next/link";

import { ActionRow } from "@/components/blocks";
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
          <Link className="primary-link" href="/sign-in">
            Open GreenRoster
          </Link>
          <Link className="secondary-link" href="/help">
            Read help
          </Link>
        </ActionRow>
      </div>
    </InformationShell>
  );
}
