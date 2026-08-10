import "server-only";

import { z } from "zod";

import type {
  BrandingAssetInput,
  ClubhouseMediaItem,
  ClubhouseNewsItem,
  ClubhouseProjection,
  ClubhouseMutationReceipt,
  CoordinatorContactInput,
  CoordinatorContactMessage,
  GroupMediaInput,
  GroupNewsInput,
  RoundMessage,
  RoundMessageInput,
} from "@/domain/clubhouse-content";
import { MutationError } from "@/lib/mutations/result";
import { createSupabaseServiceClient } from "@/lib/supabase/service-client";

const contentRowSchema = z
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
const mutationRowSchema = z.record(z.string(), z.unknown());
const messageRowSchema = z
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
const contactRowSchema = z
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

function mapRpcError(
  error: Readonly<{ code?: string; message?: string }>,
): MutationError {
  if (error.code === "P0003")
    return new MutationError("forbidden", { cause: error });
  if (error.code === "P0002")
    return new MutationError("unavailable", { cause: error });
  if (
    error.code === "22023" ||
    error.code === "22004" ||
    error.code === "23514"
  )
    return new MutationError("validation", { cause: error });
  if (error.code === "23505" || error.code === "40001")
    return new MutationError("operation_reused", { cause: error });
  return new MutationError("unexpected", { cause: error });
}

export async function executeReadClubhouseContent(
  actorUserId: string,
  limit = 50,
): Promise<ClubhouseProjection> {
  const { data, error } = await createSupabaseServiceClient().rpc(
    "read_group_content_for_actor",
    { p_actor_user_id: actorUserId, p_limit: limit },
  );
  if (error) throw mapRpcError(error);
  const parsed = z.array(contentRowSchema).safeParse(data);
  if (!parsed.success)
    throw new MutationError("unexpected", { cause: parsed.error });
  const rows = parsed.data;
  const first = rows[0];
  if (!first) return { groupId: "", groupName: "", news: [], media: [] };
  const news = new Map<string, ClubhouseNewsItem>();
  const media = new Map<string, ClubhouseMediaItem>();
  for (const row of rows) {
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
        displayFrom: row.media_display_from,
        displayUntil: row.media_display_until,
        isDefault: row.media_is_default ?? false,
      });
  }
  return {
    groupId: first.group_id,
    groupName: first.group_name,
    news: [...news.values()],
    media: [...media.values()],
  };
}

async function executeRpc(
  name: string,
  args: Record<string, unknown>,
): Promise<ClubhouseMutationReceipt> {
  const { data, error } = await createSupabaseServiceClient().rpc(name, args);
  if (error) throw mapRpcError(error);
  const parsed = z.array(mutationRowSchema).length(1).safeParse(data);
  if (!parsed.success)
    throw new MutationError("unexpected", { cause: parsed.error });
  return parsed.data[0];
}

export function executeSaveGroupNews(
  actorUserId: string,
  input: GroupNewsInput,
  correlationId: string,
) {
  return executeRpc("save_group_news", {
    p_actor_user_id: actorUserId,
    p_news_id: input.newsId ?? null,
    p_title: input.title,
    p_body: input.body,
    p_state: input.state,
    p_publish_at: input.publishAt ?? null,
    p_correlation_id: correlationId,
    p_operation_id: input.operationId,
  });
}

export function executeSaveGroupMedia(
  actorUserId: string,
  input: GroupMediaInput,
  correlationId: string,
) {
  return executeRpc("save_group_media", {
    p_actor_user_id: actorUserId,
    p_media_id: input.mediaId ?? null,
    p_title: input.title,
    p_kind: input.kind,
    p_media_url: input.mediaUrl,
    p_thumbnail_url: input.thumbnailUrl ?? null,
    p_display_from: input.displayFrom ?? null,
    p_display_until: input.displayUntil ?? null,
    p_is_default: input.isDefault,
    p_state: input.state,
    p_correlation_id: correlationId,
    p_operation_id: input.operationId,
  });
}

export function executePostRoundMessage(
  actorUserId: string,
  input: RoundMessageInput,
  correlationId: string,
) {
  return executeRpc("post_round_message", {
    p_actor_user_id: actorUserId,
    p_round_id: input.roundId,
    p_body: input.body,
    p_correlation_id: correlationId,
    p_operation_id: input.operationId,
  });
}

export function executeSendCoordinatorContact(
  actorUserId: string,
  input: CoordinatorContactInput,
  correlationId: string,
) {
  return executeRpc("send_coordinator_contact", {
    p_actor_user_id: actorUserId,
    p_recipient_membership_id: input.recipientMembershipId,
    p_body: input.body,
    p_correlation_id: correlationId,
    p_operation_id: input.operationId,
  });
}

export function executeSaveBrandingAsset(
  actorUserId: string,
  input: BrandingAssetInput,
  correlationId: string,
) {
  return executeRpc("save_group_branding_asset", {
    p_actor_user_id: actorUserId,
    p_asset_id: input.assetId ?? null,
    p_slot: input.slot,
    p_storage_path: input.storagePath ?? null,
    p_asset_url: input.assetUrl,
    p_mime_type: input.mimeType,
    p_byte_size: input.byteSize,
    p_alt_text: input.altText ?? null,
    p_decorative: input.decorative,
    p_click_url: input.clickUrl ?? null,
    p_display_order: input.displayOrder,
    p_correlation_id: correlationId,
    p_operation_id: input.operationId,
  });
}

export async function executeReadRoundMessages(
  actorUserId: string,
  roundId: string,
): Promise<readonly RoundMessage[]> {
  const { data, error } = await createSupabaseServiceClient().rpc(
    "read_round_messages_for_actor",
    { p_actor_user_id: actorUserId, p_round_id: roundId },
  );
  if (error) throw mapRpcError(error);
  const parsed = z.array(messageRowSchema).safeParse(data);
  if (!parsed.success)
    throw new MutationError("unexpected", { cause: parsed.error });
  return parsed.data.map((row) => ({
    messageId: row.message_id,
    groupId: row.group_id,
    roundId: row.round_id,
    authorDisplayName: row.author_display_name,
    authorRole: row.author_role,
    body: row.body,
    createdAt: row.created_at,
    removedAt: row.removed_at,
    removalReason: row.removal_reason,
  }));
}

export async function executeReadCoordinatorContacts(
  actorUserId: string,
): Promise<readonly CoordinatorContactMessage[]> {
  const { data, error } = await createSupabaseServiceClient().rpc(
    "read_coordinator_contacts_for_actor",
    { p_actor_user_id: actorUserId },
  );
  if (error) throw mapRpcError(error);
  const parsed = z.array(contactRowSchema).safeParse(data);
  if (!parsed.success)
    throw new MutationError("unexpected", { cause: parsed.error });
  return parsed.data.map((row) => ({
    messageId: row.message_id,
    groupId: row.group_id,
    senderDisplayName: row.sender_display_name,
    recipientDisplayName: row.recipient_display_name,
    body: row.body,
    createdAt: row.created_at,
    sentByActor: row.sent_by_actor,
  }));
}
