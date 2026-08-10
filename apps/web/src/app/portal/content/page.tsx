import Link from "next/link";

import { ClubhouseAdminPanel } from "./clubhouse-admin-panel";
import { PortalShell } from "../portal-shell";
import { resolveClubhousePortalContext } from "@/lib/portal/portal-context";
import { executeReadClubhouseContent } from "@/lib/clubhouse/clubhouse-content-data";

export default async function ClubhouseContentPage() {
  const context = await resolveClubhousePortalContext("/portal/content");
  if (context.role === "member")
    return (
      <PortalShell
        email={context.email}
        groupName={context.groupName}
        role={context.role}
        timeZone={context.timeZone}
        currentSection="content"
      >
        <section className="portal-ledger role-denied">
          <h1>You can’t manage clubhouse news.</h1>
          <p>You can read clubhouse news from your member home.</p>
          <Link className="secondary-link" href="/portal">
            Return to portal home
          </Link>
        </section>
      </PortalShell>
    );
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
      <section className="portal-ledger" aria-labelledby="clubhouse-page-title">
        <p className="ledger-kicker">Clubhouse</p>
        <h1 id="clubhouse-page-title">Your group news and videos</h1>
        <p>You share dated news and secure video links with active members.</p>
        <ClubhouseAdminPanel initial={initial} />
      </section>
    </PortalShell>
  );
}
