import { isAuthRetryableFetchError } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { z } from "zod";

import { signInPath } from "../../../../lib/auth/safe-return-path";
import { verifyMutationSession } from "../../../../lib/auth/verify-mutation-session";
import { createServerComponentSupabaseClient } from "../../../../lib/supabase/server-component-client";
import { PortalShell } from "../../portal-shell";
import { MemberImportPanel } from "./member-import-panel";
import { Kicker, portalPanelClass } from "@/components/blocks";

const contextSchema = z
  .array(
    z.object({
      group_id: z.uuid(),
      role: z.enum(["member", "coordinator", "administrator"]),
    }),
  )
  .max(1);
const groupSchema = z.object({ name: z.string(), time_zone: z.string() });

export default async function MemberImportPage() {
  try {
    await verifyMutationSession();
  } catch {
    redirect(signInPath("/portal/members/import"));
  }

  const supabase = await createServerComponentSupabaseClient();
  const userResult = await supabase.auth.getUser();
  if (
    userResult.error ||
    isAuthRetryableFetchError(userResult.error) ||
    !userResult.data.user?.email
  ) {
    redirect(signInPath("/portal/members/import"));
  }
  const contextResult = await supabase.rpc("resolve_identity_context");
  const parsedContext = contextSchema.safeParse(contextResult.data);
  const context = parsedContext.success ? parsedContext.data[0] : undefined;
  if (contextResult.error || !context) {
    redirect("/portal");
  }
  const groupResult = await supabase
    .from("groups")
    .select("name,time_zone")
    .eq("id", context.group_id)
    .single();
  const group = groupSchema.safeParse(groupResult.data);
  if (groupResult.error || !group.success) redirect("/portal");

  return (
    <PortalShell
      currentSection="members"
      email={userResult.data.user.email}
      groupName={group.data.name}
      role={context.role}
      timeZone={group.data.time_zone}
    >
      <section
        className={portalPanelClass}
        aria-labelledby="member-import-title"
      >
        <Kicker>Add many members at once</Kicker>
        <h1 id="member-import-title">Import members</h1>
        {context.role === "member" ? (
          <div className="[&_h2]:mx-0 [&_h2]:mt-0 [&_h2]:mb-3 [&_h2]:font-semibold">
            <h2>Coordinator access needed</h2>
            <p>Only coordinators and administrators can import members.</p>
          </div>
        ) : (
          <>
            <p>
              Download the template, fill it in, and upload it as a CSV file. We
              skip rows for people who are already members or already invited.
            </p>
            <MemberImportPanel />
          </>
        )}
      </section>
    </PortalShell>
  );
}
