import { z } from "zod";

import { mobileSupabase } from "../auth/mobile-supabase";
import { createMobileOperationId } from "../mobile-operation-id";

const rowSchema = z
  .object({
    group_id: z.uuid(),
    group_name: z.string(),
    news_id: z.uuid().nullable(),
    news_title: z.string().nullable(),
    news_body: z.string().nullable(),
    news_author: z.string().nullable(),
    news_publish_at: z.string().nullable(),
    media_id: z.uuid().nullable(),
    media_title: z.string().nullable(),
    media_kind: z.enum(["video", "external"]).nullable(),
    media_url: z.string().nullable(),
    thumbnail_url: z.string().nullable(),
    media_display_from: z.string().nullable(),
    media_display_until: z.string().nullable(),
    media_is_default: z.boolean().nullable(),
  })
  .strict();
const messageSchema = z
  .object({
    message_id: z.uuid(),
    group_id: z.uuid(),
    round_id: z.uuid(),
    author_display_name: z.string(),
    author_role: z.enum(["member", "coordinator", "administrator"]),
    body: z.string().nullable(),
    created_at: z.string(),
    removed_at: z.string().nullable(),
    removal_reason: z.string().nullable(),
  })
  .strict();
const coordinatorSchema = z
  .object({
    membership_id: z.uuid(),
    display_name: z.string(),
    role: z.enum(["coordinator", "administrator"]),
  })
  .strict();
const coordinatorContactSchema = z
  .object({
    message_id: z.uuid(),
    group_id: z.uuid(),
    sender_display_name: z.string(),
    recipient_display_name: z.string(),
    body: z.string(),
    created_at: z.string(),
    sent_by_actor: z.boolean(),
  })
  .strict();

export type MobileClubhouseNews = Readonly<{
  id: string;
  title: string;
  body: string;
  author: string;
  publishAt: string | null;
}>;
export type MobileClubhouseMedia = Readonly<{
  id: string;
  title: string;
  kind: "video" | "external";
  mediaUrl: string;
  thumbnailUrl: string | null;
  isDefault: boolean;
}>;
export type MobileClubhouseData = Readonly<{
  groupId: string;
  groupName: string;
  news: readonly MobileClubhouseNews[];
  media: readonly MobileClubhouseMedia[];
}>;
export type MobileRoundMessage = Readonly<{
  messageId: string;
  groupId: string;
  roundId: string;
  authorDisplayName: string;
  authorRole: "member" | "coordinator" | "administrator";
  body: string | null;
  createdAt: string;
  removedAt: string | null;
  removalReason: string | null;
}>;
export type MobileCoordinator = Readonly<{
  membershipId: string;
  displayName: string;
  role: "coordinator" | "administrator";
}>;
export type MobileCoordinatorContact = Readonly<{
  messageId: string;
  groupId: string;
  senderDisplayName: string;
  recipientDisplayName: string;
  body: string;
  createdAt: string;
  sentByActor: boolean;
}>;
export type MobileClubhouseResult =
  | Readonly<{ ok: true; data: MobileClubhouseData }>
  | Readonly<{ ok: false; message: string }>;
export type MobileCoordinatorContactsResult =
  | Readonly<{ ok: true; data: readonly MobileCoordinatorContact[] }>
  | Readonly<{ ok: false; message: string }>;

export const mobileClubhouseApi = {
  async read(): Promise<MobileClubhouseResult> {
    try {
      const { data, error } = await mobileSupabase.rpc(
        "resolve_mobile_group_content",
        { p_limit: 50 },
      );
      if (error)
        return {
          ok: false,
          message: "You can't load group news right now. Try again.",
        };
      const parsed = z.array(rowSchema).safeParse(data);
      if (!parsed.success || !parsed.data[0])
        return {
          ok: false,
          message: "You can't load group news right now. Try again.",
        };
      const news = new Map<string, MobileClubhouseNews>();
      const media = new Map<string, MobileClubhouseMedia>();
      for (const row of parsed.data) {
        if (row.news_id && row.news_title && row.news_body && row.news_author)
          news.set(row.news_id, {
            id: row.news_id,
            title: row.news_title,
            body: row.news_body,
            author: row.news_author,
            publishAt: row.news_publish_at,
          });
        if (row.media_id && row.media_title && row.media_kind && row.media_url)
          media.set(row.media_id, {
            id: row.media_id,
            title: row.media_title,
            kind: row.media_kind,
            mediaUrl: row.media_url,
            thumbnailUrl: row.thumbnail_url,
            isDefault: row.media_is_default ?? false,
          });
      }
      return {
        ok: true,
        data: {
          groupId: parsed.data[0].group_id,
          groupName: parsed.data[0].group_name,
          news: [...news.values()],
          media: [...media.values()],
        },
      };
    } catch {
      return {
        ok: false,
        message: "You can't load group news right now. Try again.",
      };
    }
  },
  async readRoundMessages(
    roundId: string,
  ): Promise<
    | Readonly<{ ok: true; data: readonly MobileRoundMessage[] }>
    | Readonly<{ ok: false; message: string }>
  > {
    try {
      const { data, error } = await mobileSupabase.rpc(
        "resolve_mobile_round_messages",
        { p_round_id: roundId },
      );
      if (error)
        return {
          ok: false,
          message:
            "You can't load this round conversation right now. Try again.",
        };
      const parsed = z.array(messageSchema).safeParse(data);
      if (!parsed.success)
        return {
          ok: false,
          message:
            "You can't load this round conversation right now. Try again.",
        };
      return {
        ok: true,
        data: parsed.data.map((row) => ({
          messageId: row.message_id,
          groupId: row.group_id,
          roundId: row.round_id,
          authorDisplayName: row.author_display_name,
          authorRole: row.author_role,
          body: row.body,
          createdAt: row.created_at,
          removedAt: row.removed_at,
          removalReason: row.removal_reason,
        })),
      };
    } catch {
      return {
        ok: false,
        message: "You can't load this round conversation right now. Try again.",
      };
    }
  },
  async postRoundMessage(roundId: string, body: string) {
    const { data, error } = await mobileSupabase.rpc(
      "post_mobile_round_message",
      {
        p_round_id: roundId,
        p_body: body.trim(),
        p_correlation_id: createMobileOperationId(),
        p_operation_id: createMobileOperationId(),
      },
    );
    if (
      error ||
      !z
        .array(
          messageSchema.pick({
            message_id: true,
            group_id: true,
            round_id: true,
            author_display_name: true,
            author_role: true,
            body: true,
            created_at: true,
          }),
        )
        .length(1)
        .safeParse(data).success
    )
      return {
        ok: false as const,
        message: "You can't post this message right now. Try again.",
      };
    return { ok: true as const };
  },
  async coordinators(): Promise<readonly MobileCoordinator[]> {
    const { data, error } = await mobileSupabase.rpc(
      "resolve_mobile_coordinators",
    );
    const parsed = z.array(coordinatorSchema).safeParse(data);
    if (error || !parsed.success) return [];
    return parsed.data.map((row) => ({
      membershipId: row.membership_id,
      displayName: row.display_name,
      role: row.role,
    }));
  },
  async contacts(): Promise<MobileCoordinatorContactsResult> {
    try {
      const { data, error } = await mobileSupabase.rpc(
        "resolve_mobile_coordinator_contacts",
      );
      const parsed = z.array(coordinatorContactSchema).safeParse(data);
      if (error || !parsed.success)
        return {
          ok: false,
          message:
            "You can't load your coordinator messages right now. Try again.",
        };
      return {
        ok: true,
        data: parsed.data.map((row) => ({
          messageId: row.message_id,
          groupId: row.group_id,
          senderDisplayName: row.sender_display_name,
          recipientDisplayName: row.recipient_display_name,
          body: row.body,
          createdAt: row.created_at,
          sentByActor: row.sent_by_actor,
        })),
      };
    } catch {
      return {
        ok: false,
        message:
          "You can't load your coordinator messages right now. Try again.",
      };
    }
  },
  async contact(recipientMembershipId: string, body: string) {
    const { error } = await mobileSupabase.rpc(
      "send_mobile_coordinator_contact",
      {
        p_recipient_membership_id: recipientMembershipId,
        p_body: body.trim(),
        p_correlation_id: createMobileOperationId(),
        p_operation_id: createMobileOperationId(),
      },
    );
    return error
      ? {
          ok: false as const,
          message: "You can't send your message right now. Try again.",
        }
      : { ok: true as const };
  },
};
