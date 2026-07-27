import { redirect } from "next/navigation";
import { isAuthRetryableFetchError } from "@supabase/supabase-js";
import { z } from "zod";

import { signInPath } from "@/lib/auth/safe-return-path";
import { verifyMutationSession } from "@/lib/auth/verify-mutation-session";
import {
  filterManageableInvitations,
  parseInvitationDeliveryFilter,
} from "@/domain/portal-list-filters";
import { executeListManageableInvitations } from "@/lib/invitations/invitation-lifecycle-data";
import { MutationError } from "@/lib/mutations/result";
import { createServerComponentSupabaseClient } from "@/lib/supabase/server-component-client";

import { PortalShell } from "../portal-shell";
import { InvitationManagement } from "./invitation-management";

const contextSchema = z
  .array(
    z.object({
      membership_id: z.uuid(),
      group_id: z.uuid(),
      role: z.enum(["member", "coordinator", "administrator"]),
    }),
  )
  .max(1);

const groupSchema = z.object({
  name: z.string(),
  time_zone: z.string(),
});

export default async function InvitationManagementPage({
  searchParams,
}: Readonly<{
  searchParams: Promise<{ delivery?: string | string[] | undefined }>;
}>) {
  let session: Awaited<ReturnType<typeof verifyMutationSession>>;
  try {
    session = await verifyMutationSession();
  } catch (error) {
    return renderLifecycleError(error);
  }

  let portalContext: PortalContext;
  try {
    portalContext = await resolvePortalContext();
  } catch (error) {
    return renderLifecycleError(error);
  }

  let invitations;
  try {
    invitations = await executeListManageableInvitations(session.userId);
  } catch (error) {
    return renderLifecycleError(error, portalContext);
  }
  const query = await searchParams;
  const deliveryFilter = parseInvitationDeliveryFilter(query.delivery);
  const visibleInvitations = filterManageableInvitations(
    invitations,
    deliveryFilter,
  );

  return (
    <PortalShell
      email={portalContext.email}
      groupName={portalContext.groupName}
      role={portalContext.role}
      timeZone={portalContext.timeZone}
      currentSection="invitations"
    >
      <section className="portal-ledger" aria-labelledby="invitations-title">
        <p className="ledger-kicker">Member administration</p>
        <h1 id="invitations-title">
          {deliveryFilter === "action-required"
            ? "Invitation delivery attention"
            : "Pending invitations"}
        </h1>
        <p>
          {deliveryFilter === "action-required"
            ? "Review pending invitations whose e-mail delivery failed permanently or is suppressed."
            : "Regenerate a single-use link, correct an address as an administrator, or revoke an invitation."}{" "}
          Every change is checked against your current group role on the server.
        </p>
        <InvitationManagement
          invitations={visibleInvitations}
          deliveryFilter={deliveryFilter}
          role={portalContext.role}
        />
      </section>
    </PortalShell>
  );
}

type PortalContext = Readonly<{
  email: string;
  groupName: string;
  role: "member" | "coordinator" | "administrator";
  timeZone: string;
}>;

async function resolvePortalContext(): Promise<PortalContext> {
  const supabase = await createServerComponentSupabaseClient();
  const userResult = await supabase.auth.getUser();
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

function renderLifecycleError(error: unknown, context?: PortalContext) {
  if (
    error instanceof MutationError &&
    error.code === "authentication_required"
  ) {
    redirect(signInPath("/portal/invitations"));
  }

  const title =
    error instanceof MutationError && error.code === "forbidden"
      ? "Invitation management is not available"
      : "Invitations could not be loaded";
  const message =
    error instanceof MutationError && error.code === "forbidden"
      ? "Your current membership does not have coordinator or administrator access."
      : "The invitation service is temporarily unavailable. Refresh and try again.";

  return (
    <PortalShell
      email={context?.email ?? "Signed-in account"}
      groupName={context?.groupName ?? "Current group"}
      {...(context
        ? { role: context.role, timeZone: context.timeZone }
        : { roleStatus: "Access unavailable", timeZone: "" })}
    >
      <section className="portal-ledger" aria-labelledby="invitations-error">
        <p className="ledger-kicker">Member administration</p>
        <h1 id="invitations-error">{title}</h1>
        <p>{message}</p>
      </section>
    </PortalShell>
  );
}
