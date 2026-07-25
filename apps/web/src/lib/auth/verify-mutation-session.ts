import "server-only";

import { MutationError } from "@/lib/mutations/result";
import { createServerActionSupabaseClient } from "@/lib/supabase/server-action-client";

export type VerifiedMutationSession = Readonly<{
  userId: string;
  emailConfirmedAt: string;
}>;

export async function verifyMutationSession(): Promise<VerifiedMutationSession> {
  const supabase = await createServerActionSupabaseClient();
  const { data, error } = await supabase.auth.getUser();
  const emailConfirmedAt = data.user?.email_confirmed_at;

  if (error || !data.user || !emailConfirmedAt) {
    throw new MutationError("authentication_required", { cause: error });
  }

  return {
    userId: data.user.id,
    emailConfirmedAt,
  };
}
