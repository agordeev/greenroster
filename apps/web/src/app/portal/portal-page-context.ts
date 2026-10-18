import { redirect } from "next/navigation";
import { z } from "zod";

import { signInPath } from "@/lib/auth/safe-return-path";
import { verifyMutationSession } from "@/lib/auth/verify-mutation-session";
import { createServerComponentSupabaseClient } from "@/lib/supabase/server-component-client";

const contextSchema = z
  .array(
    z.object({
      group_id: z.uuid(),
      role: z.enum(["member", "coordinator", "administrator"]),
    }),
  )
  .max(1);
const groupSchema = z.object({ name: z.string(), time_zone: z.string() });

export type PortalPageContext = Readonly<{
  email: string;
  groupId: string;
  groupName: string;
  role: "coordinator" | "administrator";
  timeZone: string;
}>;

// Shared gate for portal pages that only coordinators and administrators open.
export async function requirePortalPageContext(
  path: string,
): Promise<PortalPageContext> {
  try {
    await verifyMutationSession();
  } catch {
    redirect(signInPath(path));
  }
  const supabase = await createServerComponentSupabaseClient();
  const contextResult = await supabase.rpc("resolve_identity_context");
  const context = contextSchema.safeParse(contextResult.data).data?.[0];
  if (contextResult.error || !context) redirect("/portal");
  if (context.role === "member") redirect("/member/home");

  const [userResult, groupResult] = await Promise.all([
    supabase.auth.getUser(),
    supabase
      .from("groups")
      .select("name,time_zone")
      .eq("id", context.group_id)
      .single(),
  ]);
  const group = groupSchema.safeParse(groupResult.data).data;
  if (userResult.error || !userResult.data.user || !group) redirect("/portal");

  return {
    email: userResult.data.user.email ?? "Signed-in account",
    groupId: context.group_id,
    groupName: group.name,
    role: context.role,
    timeZone: group.time_zone,
  };
}
