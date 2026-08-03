import "server-only";

import { z } from "zod";

import { resolvePasswordRecoveryState } from "./password-recovery-registry";
import { resolveVerifiedSessionClaims } from "./verified-session-claims";
import { createServerComponentSupabaseClient } from "../supabase/server-component-client";

type MemberPageClient = Awaited<
  ReturnType<typeof createServerComponentSupabaseClient>
>;

type MemberPageSessionResult =
  | Readonly<{ state: "authentication_required" }>
  | Readonly<{ state: "recovery_active" }>
  | Readonly<{ state: "recovery_restricted" }>
  | Readonly<{ state: "role_redirect" }>
  | Readonly<{ state: "unavailable" }>
  | Readonly<{
      state: "ready";
      client: MemberPageClient;
      groupId: string;
      userId: string;
    }>;

type MemberPageSessionDependencies = Readonly<{
  createClient: () => MemberPageClient | Promise<MemberPageClient>;
  resolveClaims: typeof resolveVerifiedSessionClaims;
  resolveRecoveryState: typeof resolvePasswordRecoveryState;
}>;

const contextSchema = z
  .array(
    z.object({
      group_id: z.uuid(),
      role: z.enum(["member", "coordinator", "administrator"]),
    }),
  )
  .length(1);

const defaultDependencies: MemberPageSessionDependencies = {
  createClient: createServerComponentSupabaseClient,
  resolveClaims: resolveVerifiedSessionClaims,
  resolveRecoveryState: resolvePasswordRecoveryState,
};

export async function resolveMemberPageSession(
  overrides?: Partial<MemberPageSessionDependencies>,
): Promise<MemberPageSessionResult> {
  const dependencies = { ...defaultDependencies, ...overrides };
  try {
    const client = await dependencies.createClient();
    const userResult = await client.auth.getUser();
    const user = userResult.data.user;
    if (userResult.error || !user || !user.email_confirmed_at) {
      return { state: "authentication_required" };
    }

    const claims = await dependencies.resolveClaims(client);
    if (!claims || claims.sub !== user.id) return { state: "unavailable" };

    const recoveryState = await dependencies.resolveRecoveryState(
      claims.session_id,
      claims.sub,
    );
    if (recoveryState === "active") return { state: "recovery_active" };
    if (recoveryState === "unavailable") return { state: "unavailable" };
    if (recoveryState !== "none") return { state: "recovery_restricted" };

    const contextResult = await client.rpc("resolve_identity_context");
    const context = contextSchema.safeParse(contextResult.data);
    if (contextResult.error || !context.success)
      return { state: "unavailable" };
    if (context.data[0].role !== "member") return { state: "role_redirect" };

    return {
      state: "ready",
      client,
      groupId: context.data[0].group_id,
      userId: user.id,
    };
  } catch {
    return { state: "unavailable" };
  }
}
