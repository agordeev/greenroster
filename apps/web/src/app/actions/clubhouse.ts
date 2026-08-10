"use server";

import { headers } from "next/headers";

import {
  runBrandingAssetMutation,
  runCoordinatorContactMutation,
  runGroupMediaMutation,
  runGroupNewsMutation,
  runRoundMessageMutation,
} from "@/domain/clubhouse-content";
import { verifyMutationSession } from "@/lib/auth/verify-mutation-session";
import {
  executePostRoundMessage,
  executeSaveBrandingAsset,
  executeSaveGroupMedia,
  executeSaveGroupNews,
  executeSendCoordinatorContact,
} from "@/lib/clubhouse/clubhouse-content-data";

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

export async function saveBrandingAssetAction(input: unknown) {
  return runBrandingAssetMutation(input, await correlationId(), {
    execute: executeSaveBrandingAsset,
    verifySession: verifyMutationSession,
  });
}
