"use server";

import { headers } from "next/headers";

import { verifyMutationSession } from "@/lib/auth/verify-mutation-session";
import { runGroupBootstrapMutation } from "@/lib/groups/bootstrap-group";
import { executeGroupBootstrap } from "@/lib/groups/bootstrap-group-data";
import { runQuotaSettingsMutation } from "@/lib/groups/quota-settings";
import { executeConfigureQuotaSettings } from "@/lib/groups/quota-settings-data";
import { runGroupProfileMutation } from "@/lib/groups/group-profile";
import { executeUpdateGroupProfile } from "@/lib/groups/group-profile-data";
import { runGroupGuestPermissionMutation } from "@/lib/groups/group-guest-permission";
import { executeUpdateGroupGuestPermission } from "@/lib/groups/group-guest-permission-data";

export async function bootstrapGroupAction(input: unknown) {
  const requestHeaders = await headers();

  return runGroupBootstrapMutation(
    input,
    requestHeaders.get("x-correlation-id"),
    {
      verifySession: verifyMutationSession,
      executeBootstrap: executeGroupBootstrap,
    },
  );
}

export async function configureQuotaSettingsAction(input: unknown) {
  const requestHeaders = await headers();

  return runQuotaSettingsMutation(
    input,
    requestHeaders.get("x-correlation-id"),
    {
      executeConfigure: executeConfigureQuotaSettings,
      verifySession: verifyMutationSession,
    },
  );
}

export async function updateGroupProfileAction(input: unknown) {
  const requestHeaders = await headers();

  return runGroupProfileMutation(
    input,
    requestHeaders.get("x-correlation-id"),
    {
      executeUpdate: executeUpdateGroupProfile,
      verifySession: verifyMutationSession,
    },
  );
}

export async function updateGroupGuestPermissionAction(input: unknown) {
  const requestHeaders = await headers();

  return runGroupGuestPermissionMutation(
    input,
    requestHeaders.get("x-correlation-id"),
    {
      executeUpdate: executeUpdateGroupGuestPermission,
      verifySession: verifyMutationSession,
    },
  );
}
