import Link from "next/link";

import { requirePortalPageContext } from "../../portal-page-context";
import { PortalShell } from "../../portal-shell";
import { MemberCreateInvite } from "../member-create-invite";

export default async function NewMemberPage() {
  const context = await requirePortalPageContext("/portal/members/new");

  return (
    <PortalShell
      email={context.email}
      groupName={context.groupName}
      role={context.role}
      timeZone={context.timeZone}
      currentSection="members"
    >
      <section className="portal-ledger" aria-labelledby="new-member-title">
        <p className="ledger-kicker">Members</p>
        <h1 id="new-member-title">Add a member</h1>
        <p>
          <Link className="secondary-link" href="/portal/members">
            ← All members
          </Link>
        </p>
        <MemberCreateInvite role={context.role} />
      </section>
    </PortalShell>
  );
}
