import "server-only";

import { redirect } from "next/navigation";
import { z } from "zod";

import { signInPath } from "@/lib/auth/safe-return-path";
import { createServerComponentSupabaseClient } from "@/lib/supabase/server-component-client";

const contextSchema = z
  .array(
    z
      .object({
        group_id: z.uuid(),
        role: z.enum(["member", "coordinator", "administrator"]),
      })
      .strict(),
  )
  .length(1);
const groupSchema = z
  .object({ name: z.string(), time_zone: z.string() })
  .strict();

export async function resolveClubhousePortalContext(returnPath: string) {
  const client = await createServerComponentSupabaseClient();
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) redirect(signInPath(returnPath));
  const identity = data.user;
  if (!identity.email_confirmed_at) redirect(signInPath(returnPath));
  const contextResult = await client.rpc("resolve_identity_context");
  const context = contextSchema.safeParse(contextResult.data);
  const actor = context.success ? context.data[0] : null;
  if (!actor) redirect("/portal");
  const groupResult = await client
    .from("groups")
    .select("name, time_zone")
    .eq("id", actor.group_id)
    .single();
  const group = groupSchema.parse(groupResult.data);
  return {
    userId: identity.id,
    email: identity.email ?? "",
    groupId: actor.group_id,
    groupName: group.name,
    role: actor.role,
    timeZone: group.time_zone,
  } as const;
}
