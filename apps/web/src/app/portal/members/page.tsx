import { redirect } from "next/navigation";
import Link from "next/link";
import { isAuthRetryableFetchError } from "@supabase/supabase-js";
import { z } from "zod";

import { ActionRow, portalPanelClass, TextLink } from "@/components/blocks";
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
import { MemberManagement, type MemberEditorTab } from "./member-management";
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

type MemberTab = MemberEditorTab | "quota" | "history";

const memberTabs: readonly Readonly<{ id: MemberTab; label: string }>[] = [
  { id: "details", label: "Details" },
  { id: "handicap", label: "Handicap" },
  { id: "quota", label: "Quota" },
  { id: "access", label: "Status and role" },
  { id: "history", label: "History" },
];

const roleLabel = {
  member: "Member",
  coordinator: "Coordinator",
  administrator: "Administrator",
} as const;

const statusLabel = {
  pending: "Pending",
  active: "Active",
  inactive: "Inactive",
} as const;

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
    tab?: string | string[] | undefined;
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
  const requestedTab = Array.isArray(query.tab) ? query.tab[0] : query.tab;
  // Opening a member's contact details is logged, so only the tab that shows
  // them loads them.
  const loadContact = !memberTabs.some(
    (tab) => tab.id === requestedTab && tab.id !== "details",
  );

  let selectedMember = null;
  let privateContact = null;
  let quotaContext = null;
  let detailProjection = null;
  if (selectedId) {
    try {
      [selectedMember, privateContact, detailProjection, quotaContext] =
        await Promise.all([
          executeGetManageableMember(session.userId, selectedId),
          loadContact
            ? executeGetMemberPrivateContactDetail(
                session.userId,
                selectedId,
                crypto.randomUUID(),
              )
            : Promise.resolve(null),
          executeGetMemberDetailProjection(session.userId, selectedId),
          portalContext.role === "administrator"
            ? executeGetMemberQuotaBootstrapContext(session.userId, selectedId)
            : Promise.resolve(null),
        ]);
    } catch (error) {
      return renderError(error, portalContext);
    }
  }

  const memberTab: MemberTab =
    memberTabs.find(
      (tab) => tab.id === requestedTab && (tab.id !== "quota" || quotaContext),
    )?.id ?? "details";
  // The details form must never open without the saved contact details.
  if (selectedId && memberTab === "details" && !loadContact) {
    redirect(`/portal/members?membership=${selectedId}`);
  }

  return (
    <PortalShell
      email={portalContext.email}
      groupName={portalContext.groupName}
      role={portalContext.role}
      timeZone={portalContext.timeZone}
      currentSection="members"
    >
      <section className={portalPanelClass} aria-labelledby="members-title">
        {selectedMember ? (
          <>
            <TextLink href="/portal/members">← All members</TextLink>
            <h1 id="members-title" className="mt-5!">
              {selectedMember.firstName} {selectedMember.lastName}
            </h1>
            <p>
              {roleLabel[selectedMember.role]} ·{" "}
              {statusLabel[selectedMember.status]} ·{" "}
              {selectedMember.duesPaid ? "Dues paid" : "Dues not set yet"}
            </p>
            <nav
              className="mt-8 flex flex-wrap gap-x-6 gap-y-1 border-b [&_a]:-mb-px [&_a]:border-b-2 [&_a]:border-b-transparent [&_a]:py-2.5 [&_a]:text-[0.875rem] [&_a]:text-muted-foreground [&_a]:no-underline [&_a:hover]:text-foreground [&_a[aria-current=page]]:border-b-primary [&_a[aria-current=page]]:font-semibold [&_a[aria-current=page]]:text-foreground"
              aria-label="Member"
            >
              {memberTabs
                .filter((tab) => tab.id !== "quota" || quotaContext)
                .map((tab) => (
                  <Link
                    key={tab.id}
                    href={`/portal/members?membership=${selectedMember.membershipId}${tab.id === "details" ? "" : `&tab=${tab.id}`}`}
                    aria-current={tab.id === memberTab ? "page" : undefined}
                  >
                    {tab.label}
                  </Link>
                ))}
            </nav>
          </>
        ) : (
          <>
            <h1 id="members-title">Members</h1>
            {portalContext.role !== "member" ? (
              <ActionRow>
                <Button asChild>
                  <Link href="/portal/members/new">Add member</Link>
                </Button>
                <Button asChild variant="outline">
                  <Link href="/portal/members/import">Import from CSV</Link>
                </Button>
                <span className="ml-auto flex flex-wrap items-center gap-x-5 gap-y-2 text-[0.875rem] text-muted-foreground max-[720px]:ml-0">
                  Download
                  <TextLink
                    href="/api/portal/exports?kind=members"
                    aria-label="Download members as CSV"
                  >
                    CSV
                  </TextLink>
                  <TextLink
                    href="/api/portal/exports?kind=members&format=pdf"
                    aria-label="Download members as PDF"
                  >
                    PDF
                  </TextLink>
                </span>
              </ActionRow>
            ) : null}
          </>
        )}
        <MemberManagement
          actorMembershipId={portalContext.actorMembershipId}
          activeCount={roster.activeCount}
          editorTab={
            memberTab === "quota" || memberTab === "history" ? null : memberTab
          }
          members={roster.members}
          privateContact={privateContact}
          role={portalContext.role}
          rosterQuery={rosterQuery}
          selectedMember={selectedMember}
          totalCount={roster.totalCount}
        />
        {quotaContext && memberTab === "quota" ? (
          <MemberQuotaEditor
            key={`${quotaContext.membershipId}:${quotaContext.projectionVersion}:${quotaContext.settingsVersion}`}
            context={quotaContext}
          />
        ) : null}
        {detailProjection && memberTab === "history" ? (
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
      <section className={portalPanelClass} aria-labelledby="members-error">
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
