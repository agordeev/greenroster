import { isAuthRetryableFetchError } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { z } from "zod";

import { signInPath } from "../../../../lib/auth/safe-return-path";
import { verifyMutationSession } from "../../../../lib/auth/verify-mutation-session";
import { createServerComponentSupabaseClient } from "../../../../lib/supabase/server-component-client";
import { PortalShell } from "../../portal-shell";
import { MemberImportPanel } from "./member-import-panel";

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
      <section className="portal-ledger" aria-labelledby="member-import-title">
        <p className="ledger-kicker">Initial roster onboarding</p>
        <h1 id="member-import-title">Import members</h1>
        {context.role === "member" ? (
          <div className="member-import-denied">
            <h2>Coordinator access required</h2>
            <p>
              Member imports are available only to coordinators and
              administrators.
            </p>
          </div>
        ) : (
          <>
            <p>
              Start with the template, then upload one CSV. Existing normalized
              member e-mails are reported as skipped. Nothing is created until
              every other row is valid and you confirm the all-or-nothing apply.
            </p>
            <MemberImportPanel />
          </>
        )}
      </section>
    </PortalShell>
  );
}
