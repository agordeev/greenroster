import "server-only";

import { z } from "zod";

import { createSupabaseServiceClient } from "@/lib/supabase/service-client";

const attachedMembershipSchema = z.array(z.object({ id: z.uuid() })).max(1);

export type IdentityAffiliation =
  | Readonly<{ ok: true; state: "unattached" | "attached" | "disabled" }>
  | Readonly<{ ok: false }>;

export async function resolveIdentityAffiliation(
  verifiedUserId: string,
): Promise<IdentityAffiliation> {
  const supabase = createSupabaseServiceClient();

  try {
    const [membershipResult, profileResult, authUserResult] = await Promise.all(
      [
        supabase
          .from("memberships")
          .select("id")
          .eq("user_id", verifiedUserId)
          .limit(1),
        supabase
          .from("user_profiles")
          .select("disabled_at")
          .eq("user_id", verifiedUserId)
          .maybeSingle(),
        supabase.auth.admin.getUserById(verifiedUserId),
      ],
    );

    if (
      membershipResult.error ||
      profileResult.error ||
      authUserResult.error ||
      !authUserResult.data.user
    ) {
      return { ok: false };
    }

    const parsed = attachedMembershipSchema.safeParse(membershipResult.data);
    if (!parsed.success) return { ok: false };

    const authUser = authUserResult.data.user;
    const bannedUntil = authUser.banned_until
      ? new Date(authUser.banned_until)
      : null;
    if (
      profileResult.data?.disabled_at ||
      authUser.deleted_at ||
      authUser.is_anonymous ||
      !authUser.email_confirmed_at ||
      (bannedUntil && bannedUntil > new Date())
    ) {
      return { ok: true, state: "disabled" };
    }

    return {
      ok: true,
      state: parsed.data.length === 1 ? "attached" : "unattached",
    };
  } catch {
    return { ok: false };
  }
}
