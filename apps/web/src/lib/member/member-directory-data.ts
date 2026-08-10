import "server-only";

import { z } from "zod";

import {
  memberDirectoryFromPayload,
  memberDirectoryPayloadSchema,
  type MemberDirectory,
} from "@/domain/member-directory";
import { MutationError } from "@/lib/mutations/result";
import { createServerComponentSupabaseClient } from "@/lib/supabase/server-component-client";

type DirectoryClient = Pick<
  Awaited<ReturnType<typeof createServerComponentSupabaseClient>>,
  "rpc"
>;

export async function executeReadMemberDirectory(
  client: DirectoryClient,
  search = "",
  alphabet: string | null = null,
): Promise<MemberDirectory> {
  if (
    search.length > 200 ||
    (alphabet !== null && !/^[A-Z]$/u.test(alphabet))
  ) {
    throw new MutationError("validation");
  }
  const { data, error } = await client.rpc("resolve_mobile_group_directory", {
    p_search: search.trim() || null,
    p_alphabet: alphabet,
  });
  if (error) {
    if (error.code === "P0003")
      throw new MutationError("forbidden", { cause: error });
    throw new MutationError("unavailable", { cause: error });
  }
  const parsed = memberDirectoryPayloadSchema.safeParse(data);
  if (!parsed.success)
    throw new MutationError("unexpected", { cause: parsed.error });
  return memberDirectoryFromPayload(parsed.data);
}

export function memberDirectorySearchParamsSchema(value: unknown) {
  return z
    .object({
      search: z.string().trim().max(200).optional(),
      alphabet: z
        .string()
        .regex(/^[A-Z]$/u)
        .optional(),
    })
    .safeParse(value);
}
