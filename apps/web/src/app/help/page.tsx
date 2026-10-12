import Link from "next/link";

import { InformationShell } from "@/app/information-shell";
import { Button } from "@/components/ui/button";

export default function HelpPage() {
  return (
    <InformationShell kicker="Help" title="Help with your group">
      <div className="max-w-168 text-muted-foreground leading-[1.65] [&_h2]:mx-0 [&_h2]:mt-8 [&_h2]:mb-2 [&_h2]:text-foreground [&_h2]:text-[1.5rem] [&_h2]:font-semibold">
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
        <Button asChild className="mt-6">
          <Link href="/support">Contact support</Link>
        </Button>
      </div>
    </InformationShell>
  );
}
