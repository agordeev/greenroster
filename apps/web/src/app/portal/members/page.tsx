import { redirect } from "next/navigation";
import Link from "next/link";
import { isAuthRetryableFetchError } from "@supabase/supabase-js";
import { z } from "zod";

import { ActionRow, Kicker, TextLink } from "@/components/blocks";
import { Button } from "@/components/ui/button";
import { signInPath } from "@/lib/auth/safe-return-path";
import { verifyMutationSession } from "@/lib/auth/verify-mutation-session";
import {
  parseMemberRosterQuery,
  requestedMemberRosterSelection,
} from "@/domain/member-roster-query";
import { executeGetMemberDetailProjection } from "@/lib/memberships/member-detail-data";
import {
  executeGetManageableMember,
  executeGetMemberPrivateContactDetail,
  executeListManageableMemberRoster,
} from "@/lib/memberships/member-management-data";
import { executeGetMemberQuotaBootstrapContext } from "@/lib/memberships/member-quota-bootstrap-data";
import { MutationError } from "@/lib/mutations/result";
import { createServerComponentSupabaseClient } from "@/lib/supabase/server-component-client";

import { PortalShell } from "../portal-shell";
import { MemberDetailSections } from "./member-detail-sections";
import { MemberManagement } from "./member-management";
import { MemberQuotaEditor } from "./member-quota-editor";

const contextSchema = z
  .array(
    z.object({
      membership_id: z.uuid(),
      group_id: z.uuid(),
      role: z.enum(["member", "coordinator", "administrator"]),
    }),
  )
  .max(1);

const groupSchema = z.object({ name: z.string(), time_zone: z.string() });

type PortalContext = Readonly<{
  actorMembershipId: string;
  email: string;
  groupName: string;
  role: "member" | "coordinator" | "administrator";
  timeZone: string;
}>;

export default async function MemberManagementPage({
  searchParams,
}: Readonly<{
  searchParams: Promise<{
    membership?: string | string[] | undefined;
    search?: string | string[] | undefined;
    alphabet?: string | string[] | undefined;
    status?: string | string[] | undefined;
    role?: string | string[] | undefined;
    dues?: string | string[] | undefined;
    sort?: string | string[] | undefined;
    direction?: string | string[] | undefined;
    page?: string | string[] | undefined;
    pageSize?: string | string[] | undefined;
  }>;
}>) {
  let session: Awaited<ReturnType<typeof verifyMutationSession>>;
  try {
    session = await verifyMutationSession();
  } catch (error) {
    return renderError(error);
  }

  let portalContext: PortalContext;
  try {
    portalContext = await resolvePortalContext();
  } catch (error) {
    return renderError(error);
  }

  const query = await searchParams;
  const rosterQuery = parseMemberRosterQuery(query);

  let roster;
  try {
    roster = await executeListManageableMemberRoster(
      session.userId,
      rosterQuery,
    );
  } catch (error) {
    return renderError(error, portalContext);
  }

  const selectedId = requestedMemberRosterSelection(query.membership);

  let selectedMember = null;
  let privateContact = null;
  let quotaContext = null;
  let detailProjection = null;
  if (selectedId) {
    try {
      [selectedMember, privateContact, detailProjection, quotaContext] =
        await Promise.all([
          executeGetManageableMember(session.userId, selectedId),
          executeGetMemberPrivateContactDetail(
            session.userId,
            selectedId,
            crypto.randomUUID(),
          ),
          executeGetMemberDetailProjection(session.userId, selectedId),
          portalContext.role === "administrator"
            ? executeGetMemberQuotaBootstrapContext(session.userId, selectedId)
            : Promise.resolve(null),
        ]);
    } catch (error) {
      return renderError(error, portalContext);
    }
  }

  return (
    <PortalShell
      email={portalContext.email}
      groupName={portalContext.groupName}
      role={portalContext.role}
      timeZone={portalContext.timeZone}
      currentSection="members"
    >
      <section
        className="mx-auto mt-6 mb-0 p-[clamp(1.5rem,4vw,3rem)] border max-w-288 bg-card max-[480px]:m-0 max-[480px]:border-0 max-[480px]:min-h-[calc(100vh_-_10rem)] [&>h2+p]:m-0 [&>h2+p]:text-muted-foreground [&>h2+p]:leading-[1.55] [&>h2]:mx-0 [&>h2]:mb-3 [&>h2]:pt-8 [&>h2]:border-t [&>h2]:text-[1.5rem] [&>h2]:font-semibold [&>h2]:mt-12! [&>p:not([data-slot=kicker])]:max-w-168 [&>p:not([data-slot=kicker])]:text-muted-foreground [&>p:not([data-slot=kicker])]:leading-[1.65] [&>p[role='alert']]:mx-0 [&>p[role='alert']]:mt-6 [&>p[role='alert']]:mb-0 [&>p[role='alert']]:p-4 [&>p[role='alert']]:border-l-[0.25rem] [&>p[role='alert']]:border-l-destructive [&>p[role='alert']]:bg-border [&>p[role='alert']]:text-foreground! [&>p[role='alert']]:leading-[1.5]! [&_form:where([data-slot=form-stack],[data-slot=quota-settings-form])]:max-w-184 [&_h1]:mx-0 [&_h1]:mt-2.5 [&_h1]:mb-4 [&_h1]:text-[length:clamp(1.75rem,3vw,2.5rem)] [&_h1]:font-semibold [&_h1]:tracking-[-0.02em] [&_h1]:leading-[1.1]"
        aria-labelledby="members-title"
      >
        <Kicker>Your group</Kicker>
        <h1 id="members-title">Members</h1>
        {selectedMember ? (
          <p>
            <TextLink href="/portal/members">← All members</TextLink>
          </p>
        ) : (
          <>
            {portalContext.role !== "member" ? (
              <ActionRow>
                <Button asChild>
                  <Link href="/portal/members/new">Add member</Link>
                </Button>
                <TextLink href="/portal/members/import">
                  Import from CSV
                </TextLink>
                <TextLink href="/api/portal/exports?kind=members">
                  Download CSV
                </TextLink>
                <TextLink href="/api/portal/exports?kind=members&format=pdf">
                  Download PDF
                </TextLink>
              </ActionRow>
            ) : null}
          </>
        )}
        <MemberManagement
          actorMembershipId={portalContext.actorMembershipId}
          activeCount={roster.activeCount}
          members={roster.members}
          privateContact={privateContact}
          role={portalContext.role}
          rosterQuery={rosterQuery}
          selectedMember={selectedMember}
          totalCount={roster.totalCount}
        />
        {quotaContext ? (
          <MemberQuotaEditor
            key={`${quotaContext.membershipId}:${quotaContext.projectionVersion}:${quotaContext.settingsVersion}`}
            context={quotaContext}
          />
        ) : null}
        {detailProjection ? (
          <MemberDetailSections
            projection={detailProjection}
            timeZone={portalContext.timeZone}
          />
        ) : null}
      </section>
    </PortalShell>
  );
}

async function resolvePortalContext(): Promise<PortalContext> {
  const supabase = await createServerComponentSupabaseClient();
  let userResult: Awaited<ReturnType<typeof supabase.auth.getUser>>;
  try {
    userResult = await supabase.auth.getUser();
  } catch (error) {
    throw new MutationError("transient", { cause: error });
  }
  if (userResult.error && isAuthRetryableFetchError(userResult.error)) {
    throw new MutationError("transient", { cause: userResult.error });
  }
  if (userResult.error || !userResult.data.user?.email) {
    throw new MutationError("authentication_required", {
      cause: userResult.error,
    });
  }

  const contextResult = await supabase.rpc("resolve_identity_context");
  const parsedContext = contextSchema.safeParse(contextResult.data);
  const context = parsedContext.success ? parsedContext.data[0] : undefined;
  if (contextResult.error || !parsedContext.success || !context) {
    throw new MutationError("forbidden", { cause: contextResult.error });
  }

  const groupResult = await supabase
    .from("groups")
    .select("name,time_zone")
    .eq("id", context.group_id)
    .single();
  const parsedGroup = groupSchema.safeParse(groupResult.data);
  if (groupResult.error || !parsedGroup.success) {
    throw new MutationError("transient", { cause: groupResult.error });
  }

  return {
    actorMembershipId: context.membership_id,
    email: userResult.data.user.email,
    groupName: parsedGroup.data.name,
    role: context.role,
    timeZone: parsedGroup.data.time_zone,
  };
}

function renderError(error: unknown, context?: PortalContext) {
  if (
    error instanceof MutationError &&
    error.code === "authentication_required"
  ) {
    redirect(signInPath("/portal/members"));
  }

  const forbidden =
    error instanceof MutationError && error.code === "forbidden";
  return (
    <PortalShell
      email={context?.email ?? "Signed-in account"}
      groupName={context?.groupName ?? "Current group"}
      {...(context
        ? {
            role: context.role,
            timeZone: context.timeZone,
          }
        : { roleStatus: "Access unavailable", timeZone: "" })}
      currentSection="members"
    >
      <section
        className="mx-auto mt-6 mb-0 p-[clamp(1.5rem,4vw,3rem)] border max-w-288 bg-card max-[480px]:m-0 max-[480px]:border-0 max-[480px]:min-h-[calc(100vh_-_10rem)] [&>h2+p]:m-0 [&>h2+p]:text-muted-foreground [&>h2+p]:leading-[1.55] [&>h2]:mx-0 [&>h2]:mb-3 [&>h2]:pt-8 [&>h2]:border-t [&>h2]:text-[1.5rem] [&>h2]:font-semibold [&>h2]:mt-12! [&>p:not([data-slot=kicker])]:max-w-168 [&>p:not([data-slot=kicker])]:text-muted-foreground [&>p:not([data-slot=kicker])]:leading-[1.65] [&>p[role='alert']]:mx-0 [&>p[role='alert']]:mt-6 [&>p[role='alert']]:mb-0 [&>p[role='alert']]:p-4 [&>p[role='alert']]:border-l-[0.25rem] [&>p[role='alert']]:border-l-destructive [&>p[role='alert']]:bg-border [&>p[role='alert']]:text-foreground! [&>p[role='alert']]:leading-[1.5]! [&_form:where([data-slot=form-stack],[data-slot=quota-settings-form])]:max-w-184 [&_h1]:mx-0 [&_h1]:mt-2.5 [&_h1]:mb-4 [&_h1]:text-[length:clamp(1.75rem,3vw,2.5rem)] [&_h1]:font-semibold [&_h1]:tracking-[-0.02em] [&_h1]:leading-[1.1]"
        aria-labelledby="members-error"
      >
        <Kicker>Your group</Kicker>
        <h1 id="members-error">
          {forbidden
            ? "You don't have access to members"
            : "We couldn't load members"}
        </h1>
        <p>
          {forbidden
            ? "Only coordinators and administrators can manage members."
            : "This page is temporarily unavailable. Refresh and try again."}
        </p>
      </section>
    </PortalShell>
  );
}
