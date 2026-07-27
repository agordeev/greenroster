import "server-only";

import { validateInvitationRuntimeEnv } from "../validate-runtime-env";

export type InvitationRuntimeConfig = Readonly<{
  appUrl: string;
  tokenSecret: string;
  ttlHours: number;
  ttlMilliseconds: number;
}>;

export function getInvitationRuntimeConfig(): InvitationRuntimeConfig {
  const runtime = validateInvitationRuntimeEnv({
    APP_URL: process.env.APP_URL,
    INVITATION_TOKEN_SECRET: process.env.INVITATION_TOKEN_SECRET,
    INVITATION_TTL_HOURS: process.env.INVITATION_TTL_HOURS,
  });

  return Object.freeze({
    appUrl: runtime.appUrl,
    tokenSecret: runtime.invitationTokenSecret,
    ttlHours: runtime.invitationTtlHours,
    ttlMilliseconds: runtime.invitationTtlMilliseconds,
  });
}
