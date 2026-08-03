import "server-only";

import {
  memberNextRoundEnvelopeSchema,
  memberNextRoundFromEnvelope,
  type MemberNextRound,
} from "../../domain/member-next-round";
import { MutationError } from "../mutations/result";
import { createSupabaseServiceClient } from "../supabase/service-client";

type SupabaseRpcError = Readonly<{ code?: string; message?: string }>;

function mapMemberNextRoundError(error: SupabaseRpcError): MutationError {
  if (error.code === "P0003") {
    return new MutationError("forbidden", { cause: error });
  }
  if (error.code === "P0002") {
    return new MutationError("unavailable", { cause: error });
  }
  if (!error.code) {
    return new MutationError("transient", { cause: error });
  }
  return new MutationError("unexpected", { cause: error });
}

export async function executeReadMemberNextRound(
  actorUserId: string,
): Promise<MemberNextRound | null> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase.rpc("read_member_next_round", {
    p_actor_user_id: actorUserId,
  });
  if (error) throw mapMemberNextRoundError(error);
  if (data === null) return null;

  const parsed = memberNextRoundEnvelopeSchema.safeParse(data);
  if (!parsed.success) {
    throw new MutationError("unexpected", { cause: parsed.error });
  }
  return memberNextRoundFromEnvelope(parsed.data);
}
