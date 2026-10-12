import Link from "next/link";

import { InformationShell } from "@/app/information-shell";

export default function HelpPage() {
  return (
    <InformationShell kicker="Help" title="Help with your group">
      <div className="information-copy">
        <p>
          Admin access is tied to your own account. The group and role in the
          portal come from your membership, and you cannot choose them in the
          browser.
        </p>
        <h2>Setting up a new group</h2>
        <p>
          Enter the group’s name and time zone. Your administrator membership is
          created at the same time, so a group is never left half set up.
        </p>
        <h2>Access questions</h2>
        <p>
          A member-only or inactive account cannot open admin pages. If the role
          shown after you sign in looks wrong, contact support. Never share your
          password.
        </p>
        <Link className="primary-link" href="/support">
          Contact support
        </Link>
      </div>
    </InformationShell>
  );
}
