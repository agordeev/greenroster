"use server";

import { headers } from "next/headers";

import { verifyMutationSession } from "@/lib/auth/verify-mutation-session";
import { runGroupBootstrapMutation } from "@/lib/groups/bootstrap-group";
import { executeGroupBootstrap } from "@/lib/groups/bootstrap-group-data";

export async function bootstrapGroupAction(input: unknown) {
  const requestHeaders = await headers();

  return runGroupBootstrapMutation(
    input,
    requestHeaders.get("x-correlation-id"),
    {
      verifySession: verifyMutationSession,
      executeBootstrap: executeGroupBootstrap,
    },
  );
}
