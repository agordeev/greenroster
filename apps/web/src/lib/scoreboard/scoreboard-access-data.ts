import "server-only";

import { z } from "zod";

import type {
  CreateScoreboardAccessInput,
  RevokeScoreboardAccessInput,
  ScoreboardAccessGrant,
} from "./scoreboard-access";
import {
  createScoreboardToken,
  scoreboardTokenDigest,
} from "./scoreboard-token";
import { MutationError } from "../mutations/result";
import { createSupabaseServiceClient } from "../supabase/service-client";
import { webRuntimeEnv } from "../runtime-env";

const createRowSchema = z
  .array(
    z
      .object({
        access_id: z.uuid(),
        group_id: z.uuid(),
        round_id: z.uuid(),
        state: z.enum(["active", "revoked"]),
        expires_at: z.string().datetime({ offset: true }),
        created_at: z.string().datetime({ offset: true }),
      })
      .strict(),
  )
  .length(1);

const revokeRowSchema = z
  .array(
    z
      .object({
        access_id: z.uuid(),
        group_id: z.uuid(),
        round_id: z.uuid(),
        state: z.enum(["active", "revoked"]),
        expires_at: z.string().datetime({ offset: true }),
        revoked_at: z.string().datetime({ offset: true }).nullable(),
      })
      .strict(),
  )
  .length(1);

const numericValueSchema = z
  .union([
    z.number().finite(),
    z.string().regex(/^-?(?:\d+(?:\.\d*)?|\.\d+)$/u),
  ])
  .transform(String)
  .nullable();

const publicScoreboardRowSchema = z
  .object({
    round_id: z.uuid(),
    group_name: z.string(),
    round_description: z.string().nullable(),
    round_state: z.literal("live"),
    round_format: z.enum(["individual_net", "individual_gross"]),
    scheduled_at: z.string().datetime({ offset: true }).nullable(),
    group_time_zone: z.string(),
    round_version: z
      .union([z.number().int().positive(), z.string()])
      .transform(Number),
    last_server_update_at: z.string().datetime({ offset: true }).nullable(),
    participant_id: z.uuid().nullable(),
    participant_kind: z.enum(["member", "guest"]).nullable(),
    player_name: z.string().nullable(),
    score_version: z
      .union([z.number().int().nonnegative(), z.string()])
      .transform(Number),
    score_changed_at: z.string().datetime({ offset: true }).nullable(),
    gross_score: numericValueSchema,
    net_score: numericValueSchema,
    golf_points: numericValueSchema,
    plus_minus: numericValueSchema,
    ranking_value: numericValueSchema,
    competition_rank: z
      .union([z.number().int().positive(), z.string()])
      .transform(Number)
      .nullable(),
  })
  .strict();

type SupabaseRpcError = Readonly<{ code?: string; message?: string }>;

function mapScoreboardError(error: SupabaseRpcError): MutationError {
  if (error.code === "P0003")
    return new MutationError("forbidden", { cause: error });
  if (error.code === "P0002")
    return new MutationError("unavailable", { cause: error });
  if (error.code === "40001" || error.code === "23505") {
    return new MutationError("operation_reused", { cause: error });
  }
  if (error.code === "22004" || error.code === "22023") {
    return new MutationError("validation", { cause: error });
  }
  if (!error.code) return new MutationError("transient", { cause: error });
  return new MutationError("unexpected", { cause: error });
}

type ScoreboardGrantRow =
  | z.infer<typeof createRowSchema>[number]
  | z.infer<typeof revokeRowSchema>[number];

function grantFromRow(
  row: ScoreboardGrantRow,
  rawToken?: string,
): ScoreboardAccessGrant {
  return {
    accessId: row.access_id,
    groupId: row.group_id,
    roundId: row.round_id,
    state: row.state,
    expiresAt: row.expires_at,
    ...(rawToken
      ? {
          url: new URL(
            `/scoreboard/${rawToken}`,
            webRuntimeEnv.appUrl,
          ).toString(),
        }
      : {}),
  };
}

export async function executeCreateScoreboardAccess(
  actorUserId: string,
  input: CreateScoreboardAccessInput,
  correlationId: string,
): Promise<ScoreboardAccessGrant> {
  const rawToken = createScoreboardToken({
    accessId: input.operationId,
    secret: webRuntimeEnv.invitationTokenSecret,
  });
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase.rpc("create_scoreboard_access", {
    p_actor_user_id: actorUserId,
    p_access_id: input.operationId,
    p_round_id: input.roundId,
    p_token_digest: scoreboardTokenDigest(rawToken),
    p_token_key_version: 1,
    p_expires_at: input.expiresAt,
    p_correlation_id: correlationId,
    p_operation_id: input.operationId,
  });
  if (error) throw mapScoreboardError(error);
  const parsed = createRowSchema.safeParse(data);
  if (!parsed.success)
    throw new MutationError("unexpected", { cause: parsed.error });
  return grantFromRow(parsed.data[0], rawToken);
}

export async function executeRevokeScoreboardAccess(
  actorUserId: string,
  input: RevokeScoreboardAccessInput,
  correlationId: string,
): Promise<ScoreboardAccessGrant> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase.rpc("revoke_scoreboard_access", {
    p_actor_user_id: actorUserId,
    p_access_id: input.accessId,
    p_reason: input.reason,
    p_correlation_id: correlationId,
    p_operation_id: input.operationId,
  });
  if (error) throw mapScoreboardError(error);
  const parsed = revokeRowSchema.safeParse(data);
  if (!parsed.success)
    throw new MutationError("unexpected", { cause: parsed.error });
  return grantFromRow(parsed.data[0]);
}

export type PublicScoreboardPlayer = Readonly<{
  participantId: string;
  participantKind: "member" | "guest";
  playerName: string;
  scoreVersion: number;
  scoreChangedAt: string | null;
  grossScore: string | null;
  netScore: string | null;
  golfPoints: string | null;
  plusMinus: string | null;
  rankingValue: string | null;
  competitionRank: number | null;
}>;

export type PublicScoreboard = Readonly<{
  roundId: string;
  groupName: string;
  roundDescription: string | null;
  roundState: "live";
  roundFormat: "individual_net" | "individual_gross";
  scheduledAt: string | null;
  groupTimeZone: string;
  roundVersion: number;
  lastUpdatedAt: string | null;
  players: readonly PublicScoreboardPlayer[];
  branding: Readonly<{
    header: readonly PublicScoreboardBranding[];
    footer: readonly PublicScoreboardBranding[];
  }>;
}>;

export type PublicScoreboardBranding = Readonly<{
  slot: "scoreboard_header" | "scoreboard_footer";
  assetUrl: string;
  altText: string | null;
  decorative: boolean;
  clickUrl: string | null;
  displayOrder: number;
}>;

export async function executeReadPublicScoreboard(
  rawToken: string,
): Promise<PublicScoreboard | null> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase.rpc("read_public_scoreboard", {
    p_token: rawToken,
  });
  if (error) throw mapScoreboardError(error);
  const parsed = z.array(publicScoreboardRowSchema).safeParse(data);
  if (!parsed.success)
    throw new MutationError("unexpected", { cause: parsed.error });
  const [first] = parsed.data;
  if (!first) return null;
  const branding = await executeReadPublicScoreboardBranding(rawToken);
  return {
    roundId: first.round_id,
    groupName: first.group_name,
    roundDescription: first.round_description,
    roundState: first.round_state,
    roundFormat: first.round_format,
    scheduledAt: first.scheduled_at,
    groupTimeZone: first.group_time_zone,
    roundVersion: first.round_version,
    lastUpdatedAt: first.last_server_update_at,
    players: parsed.data.flatMap((row) =>
      row.participant_id && row.participant_kind && row.player_name
        ? [
            {
              participantId: row.participant_id,
              participantKind: row.participant_kind,
              playerName: row.player_name,
              scoreVersion: row.score_version,
              scoreChangedAt: row.score_changed_at,
              grossScore: row.gross_score,
              netScore: row.net_score,
              golfPoints: row.golf_points,
              plusMinus: row.plus_minus,
              rankingValue: row.ranking_value,
              competitionRank: row.competition_rank,
            },
          ]
        : [],
    ),
    branding: {
      header: branding.filter((item) => item.slot === "scoreboard_header"),
      footer: branding.filter((item) => item.slot === "scoreboard_footer"),
    },
  };
}

const scoreboardBrandingRowSchema = z
  .object({
    slot: z.enum(["scoreboard_header", "scoreboard_footer"]),
    asset_url: z.string().url(),
    alt_text: z.string().nullable(),
    decorative: z.boolean(),
    click_url: z.string().url().nullable(),
    display_order: z.number().int().nonnegative(),
  })
  .strict();

export async function executeReadPublicScoreboardBranding(
  rawToken: string,
): Promise<readonly PublicScoreboardBranding[]> {
  const { data, error } = await createSupabaseServiceClient().rpc(
    "read_public_scoreboard_branding",
    { p_token: rawToken },
  );
  if (error) throw mapScoreboardError(error);
  const parsed = z.array(scoreboardBrandingRowSchema).safeParse(data);
  if (!parsed.success)
    throw new MutationError("unexpected", { cause: parsed.error });
  return parsed.data.map((row) => ({
    slot: row.slot,
    assetUrl: row.asset_url,
    altText: row.alt_text,
    decorative: row.decorative,
    clickUrl: row.click_url,
    displayOrder: row.display_order,
  }));
}
