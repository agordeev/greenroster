import Link from "next/link";

import { ActionRow } from "@/components/ui";
import { InformationShell } from "@/app/information-shell";

export default function HomePage() {
  return (
    <InformationShell kicker="Home" title="Your group, rounds, and roster">
      <div className="information-copy">
        <p>
          Everyone signs in with their own account, and your group access comes
          from your membership. Administrators and coordinators use the portal;
          members use the member pages.
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
