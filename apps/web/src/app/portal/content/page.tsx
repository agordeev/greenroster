import { redirect } from "next/navigation";

import { ClubhouseAdminPanel } from "./clubhouse-admin-panel";
import { PortalShell } from "../portal-shell";
import { resolveClubhousePortalContext } from "@/lib/portal/portal-context";
import { executeReadClubhouseContent } from "@/lib/clubhouse/clubhouse-content-data";
import { portalPanelClass } from "@/components/blocks";

export default async function ClubhouseContentPage() {
  const context = await resolveClubhousePortalContext("/portal/content");
  // Members read clubhouse news on their own home.
  if (context.role === "member") redirect("/member/home");
  const initial = await executeReadClubhouseContent(context.userId).catch(
    () => ({
      groupId: context.groupId,
      groupName: context.groupName,
      news: [],
      media: [],
    }),
  );
  return (
    <PortalShell
      email={context.email}
      groupName={context.groupName}
      role={context.role}
      timeZone={context.timeZone}
      currentSection="content"
    >
      <section
        className={portalPanelClass}
        aria-labelledby="clubhouse-page-title"
      >
        <h1 id="clubhouse-page-title">Clubhouse</h1>
        <p>Share news and video links with your active members.</p>
        <ClubhouseAdminPanel initial={initial} />
      </section>
    </PortalShell>
  );
}
