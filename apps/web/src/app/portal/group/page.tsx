import Link from "next/link";
import { redirect } from "next/navigation";
import { isAuthRetryableFetchError } from "@supabase/supabase-js";
import { z } from "zod";

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
import { MutationError } from "@/lib/mutations/result";
import { createServerComponentSupabaseClient } from "@/lib/supabase/server-component-client";

import { GroupActivityFilterForm } from "./group-activity-filter";
import { PortalShell } from "../portal-shell";

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
          className="portal-ledger role-denied"
          aria-labelledby="group-denied-title"
        >
          <p className="ledger-kicker">Group administration</p>
          <h1 id="group-denied-title">Group administration is not available</h1>
          <p>
            Your current member role can view the group directory in the app,
            but cannot access portal roles or activity.
          </p>
          <div className="information-actions">
            <Link className="secondary-link" href="/portal">
              Return to portal home
            </Link>
          </div>
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
          className="portal-ledger role-denied"
          aria-labelledby="group-filter-error-title"
        >
          <p className="ledger-kicker">Investigation trail</p>
          <h1 id="group-filter-error-title">Activity filter needs attention</h1>
          <p>{activityFilterErrorMessage(query.filterError)}</p>
          <div className="information-actions">
            <Link className="secondary-link" href="/portal/group">
              Clear filter
            </Link>
          </div>
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
      <section
        className="portal-ledger group-roles-activity"
        aria-labelledby="group-title"
      >
        <p className="ledger-kicker">Group administration</p>
        <h1 id="group-title">Roles and recent activity</h1>
        <p>
          Review who can operate this group and the consequential changes that
          are safe to investigate. Role changes remain on the member record;
          this page only links to that detail.
        </p>

        <section className="group-roles-panel" aria-labelledby="roles-title">
          <div className="group-panel-heading">
            <div>
              <p className="ledger-kicker">Access map</p>
              <h2 id="roles-title">Administrators and coordinators</h2>
            </div>
            <p>{projection.roles.length} listed</p>
          </div>
          {projection.roles.length === 0 ? (
            <p className="group-empty" role="status">
              No administrator or coordinator roles are available to display.
            </p>
          ) : (
            <ul className="group-role-list">
              {projection.roles.map((role) => (
                <li key={role.membershipId} className="group-role-row">
                  <div>
                    <Link
                      className="group-role-name"
                      href={`/portal/members?membership=${encodeURIComponent(role.membershipId)}`}
                    >
                      {formatRoleHolderName(role.firstName, role.lastName)}
                    </Link>
                    <p>
                      {formatPortalRole(role.role)} · {role.status}
                    </p>
                  </div>
                  <div className="group-role-meta">
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
          className="group-activity-panel"
          aria-labelledby="activity-title"
        >
          <div className="group-panel-heading">
            <div>
              <p className="ledger-kicker">Investigation trail</p>
              <h2 id="activity-title">Recent activity</h2>
            </div>
            <p>
              {query.targetType
                ? `Filtered by ${query.targetType}`
                : "All entities"}
            </p>
          </div>
          <GroupActivityFilterForm
            targetType={query.targetType}
            targetId={query.targetId}
          />

          {projection.activity.items.length === 0 ? (
            <p className="group-empty" role="status">
              {query.targetType
                ? "No activity matches this entity filter. Clear the filter to review the full trail."
                : "No consequential activity has been recorded yet."}
            </p>
          ) : (
            <ol className="group-activity-list">
              {projection.activity.items.map((item) => (
                <li key={item.eventId} className="group-activity-item">
                  <div className="group-activity-heading">
                    <h3>{formatActivityAction(item.action)}</h3>
                    <time dateTime={item.occurredAt}>
                      {formatTimestamp(
                        item.occurredAt,
                        projection.group.timeZone,
                      )}
                    </time>
                  </div>
                  <dl className="group-activity-facts">
                    <div>
                      <dt>Actor</dt>
                      <dd>
                        {item.actor
                          ? `${item.actor.displayName} · current role: ${formatPortalRole(item.actor.role)}`
                          : "System actor"}
                      </dd>
                    </div>
                    <div>
                      <dt>Source</dt>
                      <dd>{item.source}</dd>
                    </div>
                    {item.target ? (
                      <div>
                        <dt>Target</dt>
                        <dd>
                          {item.target.type}
                          {item.target.id ? (
                            <>
                              {" · "}
                              <code>{item.target.id}</code>
                            </>
                          ) : null}
                          {item.target.version !== null
                            ? ` · v${item.target.version}`
                            : null}
                        </dd>
                      </div>
                    ) : null}
                    <div>
                      <dt>Correlation</dt>
                      <dd>
                        <code className="group-activity-id">
                          {item.correlationId}
                        </code>
                      </dd>
                    </div>
                    {item.reason ? (
                      <div>
                        <dt>Reason</dt>
                        <dd>{item.reason}</dd>
                      </div>
                    ) : null}
                  </dl>
                  <div
                    className="group-activity-summary"
                    aria-label="Safe change summary"
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
                </li>
              ))}
            </ol>
          )}
          {projection.activity.hasMore && nextHref ? (
            <p className="group-activity-next">
              <Link className="secondary-link" href={nextHref}>
                View older activity
              </Link>
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
      <section className="portal-ledger" aria-labelledby="group-error-title">
        <p className="ledger-kicker">Group administration</p>
        <h1 id="group-error-title">
          {forbidden
            ? "Group activity is not available"
            : "Group roles and activity could not be loaded"}
        </h1>
        <p>
          {forbidden
            ? "Your current membership does not have coordinator or administrator access."
            : "The group activity service is temporarily unavailable. Refresh and try again."}
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
  return `${firstName} ${lastName}`.trim() || "Unnamed role holder";
}

function activityFilterErrorMessage(
  error: NonNullable<
    ReturnType<typeof parseGroupRolesActivityQuery>["filterError"]
  >,
): string {
  switch (error) {
    case "target_type_required":
      return "Choose an entity type before entering an entity ID.";
    case "target_type_invalid":
      return "Choose Member or Round as the entity type.";
    case "target_id_required":
      return "Enter the UUID for the selected entity.";
    case "target_id_invalid":
      return "Enter a valid entity UUID, then apply the filter again.";
  }
}
