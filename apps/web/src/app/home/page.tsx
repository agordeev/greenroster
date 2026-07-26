import Link from "next/link";

import { InformationShell } from "@/app/information-shell";

export default function HomePage() {
  return (
    <InformationShell kicker="Home" title="Your group, rounds, and roster">
      <div className="information-copy">
        <p>
          GreenRoster gives every person their own account and resolves group
          access from the membership stored on the server. Administrators and
          coordinators use the portal; members use the member experience.
        </p>
        <div className="information-actions">
          <Link className="primary-link" href="/sign-in">
            Open GreenRoster
          </Link>
          <Link className="secondary-link" href="/help">
            Read help
          </Link>
        </div>
      </div>
    </InformationShell>
  );
}
