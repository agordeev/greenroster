import { requirePortalPageContext } from "../../portal-page-context";
import { PortalShell } from "../../portal-shell";
import { MemberCreateInvite } from "../member-create-invite";
import { portalPanelClass, TextLink } from "@/components/blocks";

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
      <section className={portalPanelClass} aria-labelledby="new-member-title">
        <TextLink href="/portal/members">← All members</TextLink>
        <h1 id="new-member-title" className="mt-5!">
          Add a member
        </h1>
        <MemberCreateInvite role={context.role} />
      </section>
    </PortalShell>
  );
}
