import Link from "next/link";

import { InformationShell } from "@/app/information-shell";

export default function HelpPage() {
  return (
    <InformationShell kicker="Help" title="Help with your group">
      <div className="information-copy">
        <p>
          Sign in with your own e-mail and password. Your group&apos;s
          administrator decides what you can do in the group.
        </p>
        <h2>Setting up a new group</h2>
        <p>
          Enter your group’s name and time zone. You become the group’s
          administrator as soon as you create it.
        </p>
        <h2>If you can&apos;t get in</h2>
        <p>
          Only coordinators and administrators can open the portal. If your role
          looks wrong after you sign in, ask your group administrator or contact
          support. Never share your password.
        </p>
        <Link className="primary-link" href="/support">
          Contact support
        </Link>
      </div>
    </InformationShell>
  );
}
