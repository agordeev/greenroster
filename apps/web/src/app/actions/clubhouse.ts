"use server";

import { randomUUID } from "node:crypto";
import { headers } from "next/headers";
import { z } from "zod";

import {
  runBrandingAssetMutation,
  runCoordinatorContactMutation,
  runGroupMediaMutation,
  runGroupNewsMutation,
  runRemoveBrandingAssetMutation,
  runRoundMessageMutation,
} from "@/domain/clubhouse-content";
import { resolveCorrelationId } from "@/lib/mutations/correlation";
import { MutationError, mutationFailure } from "@/lib/mutations/result";
import { verifyMutationSession } from "@/lib/auth/verify-mutation-session";
import {
  executePostRoundMessage,
  executeRemoveBrandingAsset,
  executeSaveBrandingAsset,
  executeSaveGroupMedia,
  executeSaveGroupNews,
  executeSendCoordinatorContact,
} from "@/lib/clubhouse/clubhouse-content-data";
import { createServerActionSupabaseClient } from "@/lib/supabase/server-action-client";
import { createSupabaseServiceClient } from "@/lib/supabase/service-client";

async function correlationId() {
  return (await headers()).get("x-correlation-id");
}

export async function saveGroupNewsAction(input: unknown) {
  return runGroupNewsMutation(input, await correlationId(), {
    execute: executeSaveGroupNews,
    verifySession: verifyMutationSession,
  });
}

export async function saveGroupMediaAction(input: unknown) {
  return runGroupMediaMutation(input, await correlationId(), {
    execute: executeSaveGroupMedia,
    verifySession: verifyMutationSession,
  });
}

export async function postRoundMessageAction(input: unknown) {
  return runRoundMessageMutation(input, await correlationId(), {
    execute: executePostRoundMessage,
    verifySession: verifyMutationSession,
  });
}

export async function sendCoordinatorContactAction(input: unknown) {
  return runCoordinatorContactMutation(input, await correlationId(), {
    execute: executeSendCoordinatorContact,
    verifySession: verifyMutationSession,
  });
}

const brandingUploadMetadataSchema = z.object({
  assetId: z.uuid().nullable(),
  slot: z.enum(["scoreboard_header", "scoreboard_footer"]),
  altText: z.string().trim().max(200).nullable(),
  decorative: z.boolean(),
  clickUrl: z.string().trim().url().startsWith("https://").nullable(),
  displayOrder: z.number().int().min(0).max(2),
  operationId: z.uuid(),
});

const imageMimeBySignature: ReadonlyArray<{
  mimeType:
    "image/png" | "image/jpeg" | "image/gif" | "image/bmp" | "image/webp";
  matches: (bytes: Uint8Array) => boolean;
}> = [
  {
    mimeType: "image/png",
    matches: (bytes) =>
      bytes.length >= 8 &&
      [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every(
        (value, index) => bytes[index] === value,
      ),
  },
  {
    mimeType: "image/jpeg",
    matches: (bytes) =>
      bytes.length >= 3 &&
      bytes[0] === 0xff &&
      bytes[1] === 0xd8 &&
      bytes[2] === 0xff,
  },
  {
    mimeType: "image/gif",
    matches: (bytes) => {
      if (bytes.length < 6) return false;
      const signature = new TextDecoder().decode(bytes.subarray(0, 6));
      return signature === "GIF87a" || signature === "GIF89a";
    },
  },
  {
    mimeType: "image/bmp",
    matches: (bytes) =>
      bytes.length >= 2 && bytes[0] === 0x42 && bytes[1] === 0x4d,
  },
  {
    mimeType: "image/webp",
    matches: (bytes) =>
      bytes.length >= 12 &&
      new TextDecoder().decode(bytes.subarray(0, 4)) === "RIFF" &&
      new TextDecoder().decode(bytes.subarray(8, 12)) === "WEBP",
  },
];

function detectedImageMime(bytes: Uint8Array) {
  return imageMimeBySignature.find((candidate) => candidate.matches(bytes))
    ?.mimeType;
}

function formValue(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

export async function uploadBrandingAssetAction(formData: FormData) {
  const correlation = resolveCorrelationId(await correlationId());
  let session: Awaited<ReturnType<typeof verifyMutationSession>>;
  try {
    session = await verifyMutationSession();
  } catch (error) {
    return mutationFailure(error, correlation);
  }

  try {
    const metadata = brandingUploadMetadataSchema.parse({
      assetId: formValue(formData, "assetId") || null,
      slot: formValue(formData, "slot"),
      altText: formValue(formData, "altText").trim() || null,
      decorative: formValue(formData, "decorative") === "true",
      clickUrl: formValue(formData, "clickUrl").trim() || null,
      displayOrder: Number(formValue(formData, "displayOrder")),
      operationId: formValue(formData, "operationId"),
    });
    if (metadata.slot === "scoreboard_header" && metadata.displayOrder !== 0) {
      throw new MutationError("validation");
    }
    if (!metadata.decorative && !metadata.altText) {
      throw new MutationError("validation");
    }

    const file = formData.get("file");
    if (
      !file ||
      typeof file !== "object" ||
      !("arrayBuffer" in file) ||
      typeof file.arrayBuffer !== "function"
    ) {
      throw new MutationError("validation");
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const maxBytes =
      metadata.slot === "scoreboard_header" ||
      metadata.slot === "scoreboard_footer"
        ? 1048576
        : 512000;
    const mimeType = detectedImageMime(bytes);
    if (!mimeType || bytes.byteLength < 1 || bytes.byteLength > maxBytes) {
      throw new MutationError("validation");
    }

    const authSupabase = await createServerActionSupabaseClient();
    const contextResult = await authSupabase.rpc("resolve_identity_context");
    const context = z
      .array(
        z
          .object({
            group_id: z.uuid(),
            role: z.enum(["member", "coordinator", "administrator"]),
          })
          .strict(),
      )
      .length(1)
      .safeParse(contextResult.data);
    if (
      contextResult.error ||
      !context.success ||
      context.data[0].role !== "administrator"
    ) {
      throw new MutationError("forbidden");
    }

    const extension =
      mimeType.split("/", 2)[1] === "jpeg" ? "jpg" : mimeType.split("/", 2)[1];
    const storagePath = `${context.data[0].group_id}/${randomUUID()}.${extension}`;
    const storageSupabase = createSupabaseServiceClient();
    let previousStoragePath: string | null = null;
    if (metadata.assetId) {
      const existing = await storageSupabase.rpc(
        "read_group_branding_assets_for_actor",
        { p_actor_user_id: session.userId },
      );
      if (existing.error) {
        throw new MutationError("unexpected", { cause: existing.error });
      }
      const existingRow = z
        .array(
          z
            .object({ asset_id: z.uuid(), storage_path: z.string().nullable() })
            .passthrough(),
        )
        .safeParse(existing.data)
        .data?.find((row) => row.asset_id === metadata.assetId);
      if (!existingRow) throw new MutationError("unavailable");
      previousStoragePath = existingRow.storage_path;
    }
    const upload = await storageSupabase.storage
      .from("group-branding")
      .upload(storagePath, new Blob([bytes], { type: mimeType }), {
        contentType: mimeType,
        upsert: false,
      });
    if (upload.error)
      throw new MutationError("transient", { cause: upload.error });

    const result = await runBrandingAssetMutation(
      {
        slot: metadata.slot,
        storagePath,
        assetUrl: `https://greenroster.invalid/group-branding/${storagePath}`,
        mimeType,
        byteSize: bytes.byteLength,
        altText: metadata.decorative ? null : metadata.altText,
        decorative: metadata.decorative,
        clickUrl: metadata.clickUrl,
        displayOrder: metadata.displayOrder,
        operationId: metadata.operationId,
      },
      correlation,
      {
        execute: executeSaveBrandingAsset,
        verifySession: async () => session,
      },
    );
    const persistedStoragePath =
      result.ok &&
      typeof result.data === "object" &&
      result.data !== null &&
      "storage_path" in result.data &&
      typeof result.data.storage_path === "string"
        ? result.data.storage_path
        : null;
    const objectsToRemove = new Set<string>();
    if (!result.ok || persistedStoragePath !== storagePath) {
      objectsToRemove.add(storagePath);
    }
    if (
      result.ok &&
      previousStoragePath &&
      previousStoragePath !== persistedStoragePath
    ) {
      objectsToRemove.add(previousStoragePath);
    }
    if (objectsToRemove.size > 0) {
      await storageSupabase.storage
        .from("group-branding")
        .remove([...objectsToRemove]);
    }
    return result;
  } catch (error) {
    return mutationFailure(error, correlation);
  }
}

export async function removeBrandingAssetAction(input: unknown) {
  const correlation = resolveCorrelationId(await correlationId());
  let session: Awaited<ReturnType<typeof verifyMutationSession>>;
  try {
    session = await verifyMutationSession();
  } catch (error) {
    return mutationFailure(error, correlation);
  }

  const storageSupabase = createSupabaseServiceClient();
  return runRemoveBrandingAssetMutation(input, correlation, {
    execute: async (actorUserId, parsedInput, correlationId) => {
      const receipt = await executeRemoveBrandingAsset(
        actorUserId,
        parsedInput,
        correlationId,
      );
      const storagePath =
        typeof receipt.storage_path === "string" ? receipt.storage_path : null;
      if (storagePath) {
        await storageSupabase.storage
          .from("group-branding")
          .remove([storagePath]);
      }
      return receipt;
    },
    verifySession: async () => session,
  });
}
