import { z } from "zod";

import type { VerifiedMutationSession } from "../lib/auth/verify-mutation-session";
import { runVerifiedMutation } from "../lib/mutations/run-verified-mutation";
import type { MutationResult } from "../lib/mutations/result";

export const groupNewsInputSchema = z
  .object({
    newsId: z.uuid().nullable().optional(),
    title: z.string().trim().min(1).max(200),
    body: z.string().trim().min(1).max(10000),
    state: z.enum(["draft", "scheduled", "published", "archived"]),
    publishAt: z.string().datetime({ offset: true }).nullable().optional(),
    operationId: z.uuid(),
  })
  .strict();

export const groupMediaInputSchema = z
  .object({
    mediaId: z.uuid().nullable().optional(),
    title: z.string().trim().min(1).max(200),
    kind: z.enum(["video", "external"]),
    mediaUrl: z.string().url().startsWith("https://"),
    thumbnailUrl: z.string().url().startsWith("https://").nullable().optional(),
    displayFrom: z.string().datetime({ offset: true }).nullable().optional(),
    displayUntil: z.string().datetime({ offset: true }).nullable().optional(),
    isDefault: z.boolean().default(false),
    state: z.enum(["draft", "scheduled", "published", "archived"]),
    operationId: z.uuid(),
  })
  .strict();

export const roundMessageInputSchema = z
  .object({
    roundId: z.uuid(),
    body: z.string().trim().min(1).max(300),
    operationId: z.uuid(),
  })
  .strict();

export const coordinatorContactInputSchema = z
  .object({
    recipientMembershipId: z.uuid(),
    body: z.string().trim().min(1).max(2000),
    operationId: z.uuid(),
  })
  .strict();

export const brandingAssetInputSchema = z
  .object({
    assetId: z.uuid().nullable().optional(),
    slot: z.enum([
      "email_header",
      "email_footer",
      "scoreboard_header",
      "scoreboard_footer",
    ]),
    storagePath: z
      .string()
      .trim()
      .min(1)
      .max(500)
      .regex(/^[0-9a-fA-F-]{36}\/[A-Za-z0-9._/-]+$/u),
    assetUrl: z.string().url().startsWith("https://"),
    mimeType: z.enum([
      "image/png",
      "image/jpeg",
      "image/gif",
      "image/bmp",
      "image/webp",
    ]),
    byteSize: z.number().int().positive().max(1048576),
    altText: z.string().trim().max(200).nullable().optional(),
    decorative: z.boolean().default(false),
    clickUrl: z.string().url().startsWith("https://").nullable().optional(),
    displayOrder: z.number().int().min(0).max(2).default(0),
    operationId: z.uuid(),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.slot === "scoreboard_header" && input.displayOrder !== 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["displayOrder"],
        message: "Keep scoreboard headers in the first position.",
      });
    }
  });

export const removeBrandingAssetInputSchema = z
  .object({
    assetId: z.uuid(),
    operationId: z.uuid(),
  })
  .strict();

export type GroupNewsInput = z.infer<typeof groupNewsInputSchema>;
export type GroupMediaInput = z.infer<typeof groupMediaInputSchema>;
export type RoundMessageInput = z.infer<typeof roundMessageInputSchema>;
export type CoordinatorContactInput = z.infer<
  typeof coordinatorContactInputSchema
>;
export type BrandingAssetInput = z.infer<typeof brandingAssetInputSchema>;
export type RemoveBrandingAssetInput = z.infer<
  typeof removeBrandingAssetInputSchema
>;
export type BrandingAssetSummary = Readonly<{
  assetId: string;
  slot: "scoreboard_header" | "scoreboard_footer";
  storagePath: string;
  assetUrl: string | null;
  altText: string | null;
  decorative: boolean;
  clickUrl: string | null;
  displayOrder: number;
  version: number;
}>;

export type ClubhouseMutationReceipt = Readonly<Record<string, unknown>>;

type Dependencies<TInput> = Readonly<{
  execute: (
    actorUserId: string,
    input: TInput,
    correlationId: string,
  ) => Promise<ClubhouseMutationReceipt>;
  verifySession: () => Promise<VerifiedMutationSession>;
}>;

export function runGroupNewsMutation(
  raw: unknown,
  correlation: string | null | undefined,
  dependencies: Dependencies<GroupNewsInput>,
): Promise<MutationResult<ClubhouseMutationReceipt>> {
  return runVerifiedMutation(raw, correlation, {
    ...dependencies,
    inputSchema: groupNewsInputSchema,
  });
}

export function runGroupMediaMutation(
  raw: unknown,
  correlation: string | null | undefined,
  dependencies: Dependencies<GroupMediaInput>,
): Promise<MutationResult<ClubhouseMutationReceipt>> {
  return runVerifiedMutation(raw, correlation, {
    ...dependencies,
    inputSchema: groupMediaInputSchema,
  });
}

export function runRoundMessageMutation(
  raw: unknown,
  correlation: string | null | undefined,
  dependencies: Dependencies<RoundMessageInput>,
): Promise<MutationResult<ClubhouseMutationReceipt>> {
  return runVerifiedMutation(raw, correlation, {
    ...dependencies,
    inputSchema: roundMessageInputSchema,
  });
}

export function runCoordinatorContactMutation(
  raw: unknown,
  correlation: string | null | undefined,
  dependencies: Dependencies<CoordinatorContactInput>,
): Promise<MutationResult<ClubhouseMutationReceipt>> {
  return runVerifiedMutation(raw, correlation, {
    ...dependencies,
    inputSchema: coordinatorContactInputSchema,
  });
}

export function runBrandingAssetMutation(
  raw: unknown,
  correlation: string | null | undefined,
  dependencies: Dependencies<BrandingAssetInput>,
): Promise<MutationResult<ClubhouseMutationReceipt>> {
  return runVerifiedMutation(raw, correlation, {
    ...dependencies,
    inputSchema: brandingAssetInputSchema,
  });
}

export function runRemoveBrandingAssetMutation(
  raw: unknown,
  correlation: string | null | undefined,
  dependencies: Dependencies<RemoveBrandingAssetInput>,
): Promise<MutationResult<ClubhouseMutationReceipt>> {
  return runVerifiedMutation(raw, correlation, {
    ...dependencies,
    inputSchema: removeBrandingAssetInputSchema,
  });
}

export type ClubhouseNewsItem = Readonly<{
  id: string;
  title: string;
  body: string;
  author: string;
  publishAt: string | null;
}>;
export type ClubhouseMediaItem = Readonly<{
  id: string;
  title: string;
  kind: "video" | "external";
  mediaUrl: string;
  thumbnailUrl: string | null;
  displayFrom: string | null;
  displayUntil: string | null;
  isDefault: boolean;
}>;
export type ClubhouseProjection = Readonly<{
  groupId: string;
  groupName: string;
  news: readonly ClubhouseNewsItem[];
  media: readonly ClubhouseMediaItem[];
}>;
export type RoundMessage = Readonly<{
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
export type CoordinatorContactMessage = Readonly<{
  messageId: string;
  groupId: string;
  senderDisplayName: string;
  recipientDisplayName: string;
  body: string;
  createdAt: string;
  sentByActor: boolean;
}>;
