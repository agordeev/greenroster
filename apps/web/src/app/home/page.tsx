import Link from "next/link";

import { ActionRow, TextLink } from "@/components/blocks";
import { Button } from "@/components/ui/button";
import { InformationShell } from "@/app/information-shell";

export default function HomePage() {
  return (
    <InformationShell kicker="Home" title="Your group, rounds, and roster">
      <div className="max-w-168 text-muted-foreground leading-[1.65] [&_h2]:mx-0 [&_h2]:mt-8 [&_h2]:mb-2 [&_h2]:text-foreground [&_h2]:text-[1.5rem] [&_h2]:font-semibold">
        <p>
          Sign in to see your next round, recent results, and where you stand.
          Coordinators and administrators also run the group from the portal.
        </p>
        <ActionRow>
          <Button asChild>
            <Link href="/sign-in">Open GreenRoster</Link>
          </Button>
          <TextLink href="/help">Read help</TextLink>
        </ActionRow>
      </div>
    </InformationShell>
  );
}
