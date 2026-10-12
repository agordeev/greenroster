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
import { Kicker } from "@/components/blocks";

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
      <section
        className="mx-auto mt-6 mb-0 p-[clamp(1.5rem,4vw,3rem)] border max-w-288 bg-card max-[480px]:m-0 max-[480px]:border-0 max-[480px]:min-h-[calc(100vh_-_10rem)] [&>h2+p]:m-0 [&>h2+p]:text-muted-foreground [&>h2+p]:leading-[1.55] [&>h2]:mx-0 [&>h2]:mb-3 [&>h2]:pt-8 [&>h2]:border-t [&>h2]:text-[1.5rem] [&>h2]:font-semibold [&>h2]:mt-12! [&>p:not([data-slot=kicker])]:max-w-168 [&>p:not([data-slot=kicker])]:text-muted-foreground [&>p:not([data-slot=kicker])]:leading-[1.65] [&>p[role='alert']]:mx-0 [&>p[role='alert']]:mt-6 [&>p[role='alert']]:mb-0 [&>p[role='alert']]:p-4 [&>p[role='alert']]:border-l-[0.25rem] [&>p[role='alert']]:border-l-destructive [&>p[role='alert']]:bg-border [&>p[role='alert']]:text-foreground! [&>p[role='alert']]:leading-[1.5]! [&_form:where([data-slot=form-stack],[data-slot=quota-settings-form])]:max-w-184 [&_h1]:mx-0 [&_h1]:mt-2.5 [&_h1]:mb-4 [&_h1]:text-[length:clamp(1.75rem,3vw,2.5rem)] [&_h1]:font-semibold [&_h1]:tracking-[-0.02em] [&_h1]:leading-[1.1]"
        aria-labelledby="invitations-title"
      >
        <Kicker>Your group</Kicker>
        <h1 id="invitations-title">Invitations</h1>
        <p>
          {deliveryFilter === "action-required"
            ? "Invitations that bounced or couldn't be sent."
            : "Send a new link, fix an address, or cancel an invitation."}{" "}
          Only administrators can fix an address.
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
      ? "You can't manage invitations"
      : "Invitations could not be loaded";
  const message =
    error instanceof MutationError && error.code === "forbidden"
      ? "Only coordinators and administrators can manage invitations."
      : "We couldn't load invitations right now. Refresh and try again.";

  return (
    <PortalShell
      email={context?.email ?? "Signed-in account"}
      groupName={context?.groupName ?? "Current group"}
      {...(context
        ? { role: context.role, timeZone: context.timeZone }
        : { roleStatus: "Access unavailable", timeZone: "" })}
    >
      <section
        className="mx-auto mt-6 mb-0 p-[clamp(1.5rem,4vw,3rem)] border max-w-288 bg-card max-[480px]:m-0 max-[480px]:border-0 max-[480px]:min-h-[calc(100vh_-_10rem)] [&>h2+p]:m-0 [&>h2+p]:text-muted-foreground [&>h2+p]:leading-[1.55] [&>h2]:mx-0 [&>h2]:mb-3 [&>h2]:pt-8 [&>h2]:border-t [&>h2]:text-[1.5rem] [&>h2]:font-semibold [&>h2]:mt-12! [&>p:not([data-slot=kicker])]:max-w-168 [&>p:not([data-slot=kicker])]:text-muted-foreground [&>p:not([data-slot=kicker])]:leading-[1.65] [&>p[role='alert']]:mx-0 [&>p[role='alert']]:mt-6 [&>p[role='alert']]:mb-0 [&>p[role='alert']]:p-4 [&>p[role='alert']]:border-l-[0.25rem] [&>p[role='alert']]:border-l-destructive [&>p[role='alert']]:bg-border [&>p[role='alert']]:text-foreground! [&>p[role='alert']]:leading-[1.5]! [&_form:where([data-slot=form-stack],[data-slot=quota-settings-form])]:max-w-184 [&_h1]:mx-0 [&_h1]:mt-2.5 [&_h1]:mb-4 [&_h1]:text-[length:clamp(1.75rem,3vw,2.5rem)] [&_h1]:font-semibold [&_h1]:tracking-[-0.02em] [&_h1]:leading-[1.1]"
        aria-labelledby="invitations-error"
      >
        <Kicker>Your group</Kicker>
        <h1 id="invitations-error">{title}</h1>
        <p>{message}</p>
      </section>
    </PortalShell>
  );
}
