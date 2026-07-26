import Link from "next/link";

import { InformationShell } from "@/app/information-shell";

export default function HelpPage() {
  return (
    <InformationShell kicker="Help" title="Start with your group’s next task">
      <div className="information-copy">
        <p>
          GreenRoster keeps group administration tied to your own verified
          account. The group and role shown in the portal come from your stored
          membership and cannot be selected in the browser.
        </p>
        <h2>Administrator first run</h2>
        <p>
          Create the group with its official name and IANA time zone. The server
          creates your administrator membership in the same operation, so a
          partial group is never left behind.
        </p>
        <h2>Access questions</h2>
        <p>
          A member-only or inactive account cannot enter administrative pages.
          If the role shown after sign-in is unexpected, contact support without
          sharing your password.
        </p>
        <Link className="primary-link" href="/support">
          Contact support
        </Link>
      </div>
    </InformationShell>
  );
}
