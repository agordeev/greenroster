import { requirePortalPageContext } from "../../portal-page-context";
import { PortalShell } from "../../portal-shell";
import { MemberCreateInvite } from "../member-create-invite";
import { Kicker, TextLink } from "@/components/blocks";

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
      <section
        className="mx-auto mt-6 mb-0 p-[clamp(1.5rem,4vw,3rem)] border max-w-288 bg-card max-[480px]:m-0 max-[480px]:border-0 max-[480px]:min-h-[calc(100vh_-_10rem)] [&>h2+p]:m-0 [&>h2+p]:text-muted-foreground [&>h2+p]:leading-[1.55] [&>h2]:mx-0 [&>h2]:mb-3 [&>h2]:pt-8 [&>h2]:border-t [&>h2]:text-[1.5rem] [&>h2]:font-semibold [&>h2]:mt-12! [&>p:not([data-slot=kicker])]:max-w-168 [&>p:not([data-slot=kicker])]:text-muted-foreground [&>p:not([data-slot=kicker])]:leading-[1.65] [&>p[role='alert']]:mx-0 [&>p[role='alert']]:mt-6 [&>p[role='alert']]:mb-0 [&>p[role='alert']]:p-4 [&>p[role='alert']]:border-l-[0.25rem] [&>p[role='alert']]:border-l-destructive [&>p[role='alert']]:bg-border [&>p[role='alert']]:text-foreground! [&>p[role='alert']]:leading-[1.5]! [&_form:where([data-slot=form-stack],[data-slot=quota-settings-form])]:max-w-184 [&_h1]:mx-0 [&_h1]:mt-2.5 [&_h1]:mb-4 [&_h1]:text-[length:clamp(1.75rem,3vw,2.5rem)] [&_h1]:font-semibold [&_h1]:tracking-[-0.02em] [&_h1]:leading-[1.1]"
        aria-labelledby="new-member-title"
      >
        <Kicker>Members</Kicker>
        <h1 id="new-member-title">Add a member</h1>
        <p>
          <TextLink href="/portal/members">← All members</TextLink>
        </p>
        <MemberCreateInvite role={context.role} />
      </section>
    </PortalShell>
  );
}
