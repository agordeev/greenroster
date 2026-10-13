import Link from "next/link";
import { redirect } from "next/navigation";
import { isAuthRetryableFetchError } from "@supabase/supabase-js";
import { z } from "zod";

import {
  ActionRow,
  EmptyState,
  portalPanelClass,
  SectionHeading,
  TextLink,
} from "@/components/blocks";
import {
  formatActivityAction,
  formatActivitySummary,
  formatInvitationState,
  formatPortalRole,
  parseGroupRolesActivityQuery,
  groupRolesActivityQueryParams,
} from "@/domain/group-roles-activity";
import { signInPath } from "@/lib/auth/safe-return-path";
import { verifyMutationSession } from "@/lib/auth/verify-mutation-session";
import { executeGroupRolesActivity } from "@/lib/groups/group-roles-activity-data";
import { executeReadGroupGuestPermission } from "@/lib/groups/group-guest-permission-data";
import { GroupProfileForm } from "./group-profile-form";
import { GroupGuestPermissionForm } from "./group-guest-permission-form";
import { MutationError } from "@/lib/mutations/result";
import { createServerComponentSupabaseClient } from "@/lib/supabase/server-component-client";

import { PortalShell } from "../portal-shell";
import { timeZoneLabel } from "@/lib/time-zone-label";

const contextSchema = z
  .array(
    z
      .object({
        membership_id: z.uuid(),
        group_id: z.uuid(),
        role: z.enum(["member", "coordinator", "administrator"]),
      })
      .strict(),
  )
  .max(1);

const groupSchema = z
  .object({ name: z.string(), time_zone: z.string() })
  .strict();

type PortalContext = Readonly<{
  email: string;
  groupName: string;
  role: "member" | "coordinator" | "administrator";
  timeZone: string;
}>;

export default async function GroupRolesActivityPage({
  searchParams,
}: Readonly<{
  searchParams: Promise<
    Readonly<Record<string, string | string[] | undefined>>
  >;
}>) {
  let session: Awaited<ReturnType<typeof verifyMutationSession>>;
  try {
    session = await verifyMutationSession();
  } catch (error) {
    return renderGroupError(error);
  }

  let portalContext: PortalContext;
  try {
    portalContext = await resolvePortalContext();
  } catch (error) {
    return renderGroupError(error);
  }

  if (portalContext.role === "member") {
    return (
      <PortalShell
        email={portalContext.email}
        groupName={portalContext.groupName}
        role={portalContext.role}
        timeZone={portalContext.timeZone}
        currentSection="group"
      >
        <section
          className={portalPanelClass}
          aria-labelledby="group-denied-title"
        >
          <h1 id="group-denied-title">You can&apos;t open this page</h1>
          <p>
            You can see the group directory in the app. Only coordinators and
            administrators can see who runs the group and what changed.
          </p>
          <ActionRow>
            <TextLink href="/portal">Return to portal home</TextLink>
          </ActionRow>
        </section>
      </PortalShell>
    );
  }

  const query = parseGroupRolesActivityQuery(await searchParams);
  if (query.filterError) {
    return (
      <PortalShell
        email={portalContext.email}
        groupName={portalContext.groupName}
        role={portalContext.role}
        timeZone={portalContext.timeZone}
        currentSection="group"
      >
        <section
          className={portalPanelClass}
          aria-labelledby="group-filter-error-title"
        >
          <h1 id="group-filter-error-title">
            We couldn&apos;t find those changes
          </h1>
          <p>
            This link doesn&apos;t point to a member or round in your group.
          </p>
          <ActionRow>
            <TextLink href="/portal/group">See all changes</TextLink>
          </ActionRow>
        </section>
      </PortalShell>
    );
  }

  let projection;
  try {
    projection = await executeGroupRolesActivity(session.userId, query);
  } catch (error) {
    return renderGroupError(error, portalContext);
  }

  let guestPermission;
  try {
    guestPermission = await executeReadGroupGuestPermission(session.userId);
  } catch (error) {
    return renderGroupError(error, portalContext);
  }

  const nextHref = projection.activity.nextCursor
    ? `/portal/group?${groupRolesActivityQueryParams({
        ...query,
        before: projection.activity.nextCursor,
      }).toString()}`
    : null;

  return (
    <PortalShell
      email={portalContext.email}
      groupName={projection.group.name}
      role={portalContext.role}
      timeZone={projection.group.timeZone}
      currentSection="group"
    >
      <section className={portalPanelClass} aria-labelledby="group-title">
        <h1 id="group-title">Group</h1>
        <p>
          Change your group&apos;s name, time zone and guest rule, and see who
          runs it. To change a role, open that person&apos;s member page.
        </p>

        <section
          className="mt-10 pt-8 border-t [&>h2]:mx-0 [&>h2]:text-[1.5rem] [&>h2]:font-semibold [&>h2]:mt-1.5! [&>h2]:mb-0!"
          aria-labelledby="profile-title"
        >
          <SectionHeading
            title="Group name and time zone"
            titleId="profile-title"
          />
          {portalContext.role === "administrator" ? (
            <GroupProfileForm
              key={`${projection.group.groupId}:${projection.group.version}`}
              identityKey={projection.group.groupId}
              initialValue={{
                groupId: projection.group.groupId,
                groupName: projection.group.name,
                groupTimeZone: projection.group.timeZone,
                groupVersion: projection.group.version,
              }}
            />
          ) : (
            <dl className="mx-0 mt-5 mb-0 gap-4 grid grid-cols-2 max-[720px]:grid-cols-[1fr] [&_dd]:mx-0 [&_dd]:mt-1 [&_dd]:mb-0 [&_dd]:text-muted-foreground [&_dd]:leading-[1.45] [&_dd]:wrap-anywhere [&_dt]:text-muted-foreground [&_dt]:font-mono [&_dt]:text-[0.6875rem] [&_dt]:tracking-[0.08em] [&_dt]:uppercase">
              <div>
                <dt>Group name</dt>
                <dd>{projection.group.name}</dd>
              </div>
              <div>
                <dt>Group time zone</dt>
                <dd>{timeZoneLabel(projection.group.timeZone)}</dd>
              </div>
            </dl>
          )}
        </section>

        <section
          className="mt-10 pt-8 border-t [&>h2]:mx-0 [&>h2]:text-[1.5rem] [&>h2]:font-semibold [&>h2]:mt-1.5! [&>h2]:mb-0! group-guest-permission-panel"
          aria-labelledby="guest-permission-title"
        >
          <SectionHeading
            title="Guests in rounds"
            titleId="guest-permission-title"
          />
          {portalContext.role === "administrator" ? (
            <GroupGuestPermissionForm
              key={`${guestPermission.groupId}:${guestPermission.groupVersion}`}
              initialValue={{
                allowMemberGuests: guestPermission.allowMemberGuests,
                groupVersion: guestPermission.groupVersion,
              }}
            />
          ) : (
            <p>
              Members{" "}
              <strong>
                {guestPermission.allowMemberGuests ? "can" : "can’t"}
              </strong>{" "}
              bring guests right now. Only an administrator can change this.
            </p>
          )}
        </section>

        <section
          className="mt-10 pt-8 border-t [&>h2]:mx-0 [&>h2]:text-[1.5rem] [&>h2]:font-semibold [&>h2]:mt-1.5! [&>h2]:mb-0!"
          aria-labelledby="roles-title"
        >
          <SectionHeading
            title="Administrators and coordinators"
            titleId="roles-title"
            meta={<>{projection.roles.length} listed</>}
          />
          {projection.roles.length === 0 ? (
            <EmptyState>
              No coordinators or administrators to show yet.
            </EmptyState>
          ) : (
            <ul className="mx-0 mt-6 mb-0 p-0 gap-3 grid list-none">
              {projection.roles.map((role) => (
                <li
                  key={role.membershipId}
                  className="p-4 gap-4 border border-border/50 flex items-center justify-between rounded-lg max-[720px]:items-start max-[720px]:flex-col [&_p]:mx-0 [&_p]:mb-0 [&_p]:text-muted-foreground [&_p]:mt-[0.35rem]! [&_p]:text-[0.8125rem]!"
                >
                  <div>
                    <Link
                      className="text-primary text-[1.125rem] font-semibold underline-offset-[0.2em]"
                      href={`/portal/members?membership=${encodeURIComponent(role.membershipId)}`}
                    >
                      {formatRoleHolderName(role.firstName, role.lastName)}
                    </Link>
                    <p>
                      {formatPortalRole(role.role)} · {role.status}
                    </p>
                  </div>
                  <div
                    className="gap-1 grid text-muted-foreground text-[0.75rem] text-right max-[720px]:text-left [&_time]:text-muted-foreground [&_time]:text-[0.6875rem]"
                    data-slot="row-meta"
                  >
                    <span>{formatInvitationState(role.invitationState)}</span>
                    {role.invitationAcceptedAt ? (
                      <time dateTime={role.invitationAcceptedAt}>
                        Accepted{" "}
                        {formatTimestamp(
                          role.invitationAcceptedAt,
                          projection.group.timeZone,
                        )}
                      </time>
                    ) : role.invitationExpiresAt ? (
                      <time dateTime={role.invitationExpiresAt}>
                        Expires{" "}
                        {formatTimestamp(
                          role.invitationExpiresAt,
                          projection.group.timeZone,
                        )}
                      </time>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section
          className="mt-10 pt-8 border-t [&>h2]:mx-0 [&>h2]:text-[1.5rem] [&>h2]:font-semibold [&>h2]:mt-1.5! [&>h2]:mb-0!"
          aria-labelledby="activity-title"
        >
          <SectionHeading
            title="Recent activity"
            titleId="activity-title"
            meta={
              query.targetType
                ? `Changes to one ${query.targetType === "round" ? "round" : "member"}`
                : "All changes"
            }
          />
          {query.targetType ? (
            <p className="mx-0 mt-4 mb-0">
              <TextLink href="/portal/group#activity-title">
                See all changes
              </TextLink>
            </p>
          ) : null}

          {projection.activity.items.length === 0 ? (
            <EmptyState>
              {query.targetType
                ? "No changes match this filter. Clear the filter to see everything."
                : "Nothing has changed yet."}
            </EmptyState>
          ) : (
            <ol className="mx-0 mt-6 mb-0 p-0 gap-3 grid list-none">
              {projection.activity.items.map((item) => (
                <li
                  key={item.eventId}
                  className="p-4 border border-border/50 rounded-lg"
                >
                  <div className="gap-4 flex items-baseline justify-between max-[720px]:items-start max-[720px]:flex-col [&_h3]:m-0 [&_h3]:text-[1.125rem] [&_h3]:font-semibold [&_time]:text-muted-foreground [&_time]:text-[0.6875rem] [&_time]:text-right max-[720px]:[&_time]:text-left!">
                    <h3>{formatActivityAction(item.action)}</h3>
                    <time dateTime={item.occurredAt}>
                      {formatTimestamp(
                        item.occurredAt,
                        projection.group.timeZone,
                      )}
                    </time>
                  </div>
                  <dl className="mx-0 mt-4 mb-0 grid grid-cols-2 gap-y-3 gap-x-4 max-[720px]:grid-cols-[1fr] [&_code]:text-[0.75rem] [&_dd]:mx-0 [&_dd]:mt-1 [&_dd]:mb-0 [&_dd]:text-muted-foreground [&_dd]:text-[0.8125rem] [&_dd]:leading-[1.45] [&_dd]:wrap-anywhere [&_dt]:text-muted-foreground [&_dt]:font-mono [&_dt]:text-[0.6875rem] [&_dt]:tracking-[0.08em] [&_dt]:uppercase">
                    <div>
                      <dt>Changed by</dt>
                      <dd>
                        {item.actor
                          ? `${item.actor.displayName} · current role: ${formatPortalRole(item.actor.role)}`
                          : "Done automatically"}
                      </dd>
                    </div>
                    {item.target?.type === "membership" ||
                    item.target?.type === "round" ? (
                      <div>
                        <dt>Item</dt>
                        <dd>
                          {formatTargetType(item.target.type)}
                          {item.target.id && !query.targetType ? (
                            <>
                              {" · "}
                              <TextLink
                                className="text-[0.8125rem]"
                                href={`/portal/group?target_type=${item.target.type}&target_id=${encodeURIComponent(item.target.id)}#activity-title`}
                              >
                                {item.target.type === "round"
                                  ? "See this round’s changes"
                                  : "See this member’s changes"}
                              </TextLink>
                            </>
                          ) : null}
                        </dd>
                      </div>
                    ) : null}
                    {item.reason ? (
                      <div>
                        <dt>Reason</dt>
                        <dd>{item.reason}</dd>
                      </div>
                    ) : null}
                  </dl>
                  {formatActivitySummary(item.before) ||
                  formatActivitySummary(item.after) ? (
                    <div
                      className="mt-4 pt-3 border-t border-t-border/50 flex flex-wrap gap-y-2 gap-x-4 text-muted-foreground text-[0.75rem]"
                      aria-label="Change summary"
                    >
                      <span>
                        Before:{" "}
                        {formatActivitySummary(item.before) ?? "Not available"}
                      </span>
                      <span>
                        After:{" "}
                        {formatActivitySummary(item.after) ?? "Not available"}
                      </span>
                    </div>
                  ) : null}
                </li>
              ))}
            </ol>
          )}
          {projection.activity.hasMore && nextHref ? (
            <p className="mx-0 mt-6 mb-0">
              <TextLink href={nextHref}>See older changes</TextLink>
            </p>
          ) : null}
        </section>
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
    email: userResult.data.user.email,
    groupName: parsedGroup.data.name,
    role: context.role,
    timeZone: parsedGroup.data.time_zone,
  };
}

function renderGroupError(error: unknown, context?: PortalContext) {
  if (
    error instanceof MutationError &&
    error.code === "authentication_required"
  ) {
    redirect(signInPath("/portal/group"));
  }

  const forbidden =
    error instanceof MutationError && error.code === "forbidden";
  return (
    <PortalShell
      email={context?.email ?? "Signed-in account"}
      groupName={context?.groupName ?? "Current group"}
      {...(context
        ? { role: context.role, timeZone: context.timeZone }
        : { roleStatus: "Access unavailable", timeZone: "" })}
      currentSection="group"
    >
      <section className={portalPanelClass} aria-labelledby="group-error-title">
        <h1 id="group-error-title">
          {forbidden
            ? "You can't open this page"
            : "We couldn't load this page"}
        </h1>
        <p>
          {forbidden
            ? "Only coordinators and administrators can open this page."
            : "We couldn't load this page right now. Refresh and try again."}
        </p>
      </section>
    </PortalShell>
  );
}

function formatTimestamp(value: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone,
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function formatRoleHolderName(firstName: string, lastName: string): string {
  return `${firstName} ${lastName}`.trim() || "Unnamed member";
}

function formatTargetType(value: string): string {
  if (value === "membership") return "Member";
  if (value === "round") return "Round";
  return value;
}
