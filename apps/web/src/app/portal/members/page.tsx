import { redirect } from "next/navigation";
import Link from "next/link";
import { isAuthRetryableFetchError } from "@supabase/supabase-js";
import { z } from "zod";

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
import { MemberCreateInvite } from "./member-create-invite";
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
      <section className="portal-ledger" aria-labelledby="members-title">
        <p className="ledger-kicker">Member administration</p>
        <h1 id="members-title">Members</h1>
        <p>
          Review every membership state, update profile and private contact
          details, confirm an active/inactive status change, or manage roles
          when your administrator access permits it. The server checks your
          current group role and record versions on every action.
        </p>
        {portalContext.role !== "member" ? (
          <>
            <p>
              <Link className="secondary-link" href="/portal/members/import">
                Import members from CSV
              </Link>
            </p>
            <p>
              <Link
                className="secondary-link"
                href="/api/portal/exports?kind=members"
              >
                Download member list (CSV)
              </Link>
            </p>
            <MemberCreateInvite role={portalContext.role} />
          </>
        ) : null}
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
      <section className="portal-ledger" aria-labelledby="members-error">
        <p className="ledger-kicker">Member administration</p>
        <h1 id="members-error">
          {forbidden
            ? "Member management is not available"
            : "Members could not be loaded"}
        </h1>
        <p>
          {forbidden
            ? "Your current membership does not have coordinator or administrator access."
            : "The member service is temporarily unavailable. Refresh and try again."}
        </p>
      </section>
    </PortalShell>
  );
}
