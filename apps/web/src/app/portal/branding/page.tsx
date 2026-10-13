import { BrandingForm } from "./branding-form";
import { PortalShell } from "../portal-shell";
import { executeReadBrandingAssetsForActor } from "@/lib/clubhouse/clubhouse-content-data";
import { resolveClubhousePortalContext } from "@/lib/portal/portal-context";
import { portalPanelClass, TextLink } from "@/components/blocks";

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
        <section className={portalPanelClass}>
          <h1>You can’t manage group branding.</h1>
          <p>Only administrators can choose scoreboard banners.</p>
          <TextLink href="/portal">Return to portal home</TextLink>
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
      <section className={portalPanelClass} aria-labelledby="branding-title">
        <h1 id="branding-title">Branding</h1>
        <p>Add your own banner to the top or bottom of the scoreboard.</p>
        <BrandingForm assets={assets} />
      </section>
    </PortalShell>
  );
}
