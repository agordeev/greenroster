import Link from "next/link";

import { BrandingForm } from "./branding-form";
import { PortalShell } from "../portal-shell";
import { executeReadBrandingAssetsForActor } from "@/lib/clubhouse/clubhouse-content-data";
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
          <p>Only administrators can choose scoreboard banners.</p>
          <Link className="secondary-link" href="/portal">
            Return to portal home
          </Link>
        </section>
      </PortalShell>
    );
  const assets = await executeReadBrandingAssetsForActor(context.userId);
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
        <h1 id="branding-title">Branding</h1>
        <p>
          Upload an image for your clubhouse scoreboard. Optional links must use
          HTTPS.
        </p>
        <BrandingForm assets={assets} />
      </section>
    </PortalShell>
  );
}
