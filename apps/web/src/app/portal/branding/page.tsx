import Link from "next/link";

import { BrandingForm } from "./branding-form";
import { PortalShell } from "../portal-shell";
import { resolveClubhousePortalContext } from "@/lib/portal/portal-context";

export default async function BrandingPage() {
  const context = await resolveClubhousePortalContext("/portal/branding");
  if (context.role !== "administrator")
    return (
      <PortalShell
        email={context.email}
        groupName={context.groupName}
        role={context.role}
        timeZone={context.timeZone}
        currentSection="branding"
      >
        <section className="portal-ledger role-denied">
          <h1>You can’t manage group branding.</h1>
          <p>You need the administrator role to choose scoreboard banners.</p>
          <Link className="secondary-link" href="/portal">
            Return to portal home
          </Link>
        </section>
      </PortalShell>
    );
  return (
    <PortalShell
      email={context.email}
      groupName={context.groupName}
      role={context.role}
      timeZone={context.timeZone}
      currentSection="branding"
    >
      <section className="portal-ledger" aria-labelledby="branding-title">
        <p className="ledger-kicker">Group branding</p>
        <h1 id="branding-title">Your scoreboard appearance</h1>
        <p>
          You choose secure images for your clubhouse display. Your banner link
          must use HTTPS.
        </p>
        <BrandingForm />
      </section>
    </PortalShell>
  );
}
