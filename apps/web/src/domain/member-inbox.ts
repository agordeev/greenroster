import { z } from "zod";

import type { VerifiedMutationSession } from "../lib/auth/verify-mutation-session";
import { runVerifiedMutation } from "../lib/mutations/run-verified-mutation";
import type { MutationResult } from "../lib/mutations/result";

const uuidSchema = z.uuid();
const instantSchema = z.string().datetime({ offset: true });

export const memberInboxItemRowSchema = z
  .object({
    inbox_item_id: uuidSchema,
    announcement_id: uuidSchema,
    group_id: uuidSchema,
    round_id: uuidSchema,
    round_description: z.string().nullable(),
    body: z.string().min(1).max(300),
    author_display_name: z.string().min(1).max(200),
    author_role: z.enum(["member", "coordinator", "administrator"]),
    created_at: instantSchema,
    read_at: instantSchema.nullable(),
  })
  .strict();

export const memberInboxRowsSchema = z.array(memberInboxItemRowSchema);

export type MemberInboxItem = Readonly<{
  inboxItemId: string;
  announcementId: string;
  groupId: string;
  roundId: string;
  roundDescription: string | null;
  body: string;
  authorDisplayName: string;
  authorRole: "member" | "coordinator" | "administrator";
  createdAt: string;
  readAt: string | null;
}>;

export function memberInboxItemFromRow(
  row: z.infer<typeof memberInboxItemRowSchema>,
): MemberInboxItem {
  return {
    inboxItemId: row.inbox_item_id,
    announcementId: row.announcement_id,
    groupId: row.group_id,
    roundId: row.round_id,
    roundDescription: row.round_description,
    body: row.body,
    authorDisplayName: row.author_display_name,
    authorRole: row.author_role,
    createdAt: row.created_at,
    readAt: row.read_at,
  };
}

export const markMemberInboxReadInputSchema = z
  .object({
    inboxItemId: uuidSchema,
    operationId: uuidSchema,
  })
  .strict();

export type MarkMemberInboxReadInput = z.infer<
  typeof markMemberInboxReadInputSchema
>;

export type MarkMemberInboxReadReceipt = Readonly<{
  inboxItemId: string;
  readAt: string;
  version: number;
}>;

export type MarkMemberInboxReadDependencies = Readonly<{
  execute: (
    actorUserId: string,
    input: MarkMemberInboxReadInput,
    correlationId: string,
  ) => Promise<MarkMemberInboxReadReceipt>;
  verifySession: () => Promise<VerifiedMutationSession>;
}>;

export async function runMarkMemberInboxReadMutation(
  rawInput: unknown,
  correlationCandidate: string | null | undefined,
  dependencies: MarkMemberInboxReadDependencies,
): Promise<MutationResult<MarkMemberInboxReadReceipt>> {
  return runVerifiedMutation(rawInput, correlationCandidate, {
    execute: dependencies.execute,
    inputSchema: markMemberInboxReadInputSchema,
    verifySession: dependencies.verifySession,
  });
}
