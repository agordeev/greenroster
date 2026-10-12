import { z } from "zod";

import { mobileSupabase } from "../auth/mobile-supabase";
import { createMobileOperationId } from "../mobile-operation-id";

const roleSchema = z.enum(["member", "coordinator", "administrator"]);
const itemRowSchema = z
  .object({
    inbox_item_id: z.uuid(),
    announcement_id: z.uuid(),
    group_id: z.uuid(),
    round_id: z.uuid(),
    round_description: z.string().nullable(),
    body: z.string().min(1).max(300),
    author_display_name: z.string().min(1).max(200),
    author_role: roleSchema,
    created_at: z.string().datetime({ offset: true }),
    read_at: z.string().datetime({ offset: true }).nullable(),
  })
  .strict();

const itemRowsSchema = z.array(itemRowSchema);
const markReadRowSchema = z
  .object({
    inbox_item_id: z.uuid(),
    read_at: z.string().datetime({ offset: true }),
    version: z
      .union([z.number().int().positive(), z.string().regex(/^\d+$/u)])
      .transform(Number)
      .refine(Number.isSafeInteger),
  })
  .strict();

export type MobileMemberInboxItem = Readonly<{
  inboxItemId: string;
  announcementId: string;
  groupId: string;
  roundId: string;
  roundDescription: string | null;
  body: string;
  authorDisplayName: string;
  authorRole: z.infer<typeof roleSchema>;
  createdAt: string;
  readAt: string | null;
}>;

export type MobileMemberInboxErrorCode =
  "permission_denied" | "validation" | "unavailable";

export type MobileMemberInboxResult =
  | Readonly<{ ok: true; data: readonly MobileMemberInboxItem[] }>
  | Readonly<{
      ok: false;
      code: MobileMemberInboxErrorCode;
      message: string;
    }>;

export type MobileMemberInboxMarkReadResult =
  | Readonly<{
      ok: true;
      data: Readonly<{ inboxItemId: string; readAt: string; version: number }>;
    }>
  | Readonly<{
      ok: false;
      code: MobileMemberInboxErrorCode;
      message: string;
    }>;

function mapError(error: Readonly<{ code?: string; message?: string }>) {
  const normalized = (error.message ?? "").toLowerCase();
  if (
    error.code === "P0003" ||
    normalized.includes("actor_not_authorized") ||
    normalized.includes("recovery_session")
  ) {
    return {
      code: "permission_denied" as const,
      message: "You can't open your round updates.",
    };
  }
  if (error.code === "22023" || error.code === "22004") {
    return {
      code: "validation" as const,
      message: "We couldn't load your round updates. Try again.",
    };
  }
  return {
    code: "unavailable" as const,
    message: "You can't load your round updates right now. Try again.",
  };
}

function mapItem(row: z.infer<typeof itemRowSchema>): MobileMemberInboxItem {
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

export const mobileMemberInboxApi = {
  async read(limit = 50): Promise<MobileMemberInboxResult> {
    try {
      const { data, error } = await mobileSupabase.rpc(
        "resolve_mobile_member_inbox",
        { p_limit: limit },
      );
      if (error) return { ...mapError(error), ok: false };
      const parsed = itemRowsSchema.safeParse(data);
      if (!parsed.success) {
        return {
          code: "unavailable",
          message: "You can't load your round updates right now. Try again.",
          ok: false,
        };
      }
      return { data: parsed.data.map(mapItem), ok: true };
    } catch {
      return {
        code: "unavailable",
        message: "You can't load your round updates right now. Try again.",
        ok: false,
      };
    }
  },

  async markRead(
    inboxItemId: string,
  ): Promise<MobileMemberInboxMarkReadResult> {
    try {
      const correlationId = createMobileOperationId();
      const operationId = createMobileOperationId();
      const { data, error } = await mobileSupabase.rpc(
        "mark_mobile_member_inbox_read",
        {
          p_inbox_item_id: inboxItemId,
          p_correlation_id: correlationId,
          p_operation_id: operationId,
        },
      );
      if (error) return { ...mapError(error), ok: false };
      const parsed = z.array(markReadRowSchema).length(1).safeParse(data);
      if (!parsed.success) {
        return {
          code: "unavailable",
          message: "You can't save this update right now. Try again.",
          ok: false,
        };
      }
      const row = parsed.data[0];
      return {
        data: {
          inboxItemId: row.inbox_item_id,
          readAt: row.read_at,
          version: row.version,
        },
        ok: true,
      };
    } catch {
      return {
        code: "unavailable",
        message: "You can't save this update right now. Try again.",
        ok: false,
      };
    }
  },
};
