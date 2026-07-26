import { NextResponse, type NextRequest } from "next/server";

import {
  createInvitationAcceptanceCookieValue,
  INVITATION_ACCEPTANCE_COOKIE,
  INVITATION_ACCEPTANCE_COOKIE_PATH,
  invitationAcceptanceCookieMaxAgeSeconds,
  invitationIdFromUnknown,
  tokenDigestFromUnknown,
} from "@/lib/invitations/invitation-acceptance-state";
import { webRuntimeEnv } from "@/lib/runtime-env";

function cleanAcceptanceUrl(status?: string): URL {
  const url = new URL("/invitations/accept", webRuntimeEnv.appUrl);
  if (status) url.searchParams.set("status", status);
  return url;
}

export function GET(request: NextRequest) {
  const invitationId = invitationIdFromUnknown(
    request.nextUrl.searchParams.get("invitationId"),
  );
  const tokenDigest = tokenDigestFromUnknown(
    request.nextUrl.searchParams.get("token"),
  );

  if (!invitationId || !tokenDigest) {
    return NextResponse.redirect(cleanAcceptanceUrl("invalid"));
  }

  const now = Math.floor(Date.now() / 1000);
  const maxAge = invitationAcceptanceCookieMaxAgeSeconds(
    webRuntimeEnv.invitationTtlMilliseconds,
  );
  const expiresAt = now + maxAge;
  const cookieValue = createInvitationAcceptanceCookieValue(
    { invitationId, tokenDigest, expiresAt, now },
    webRuntimeEnv.invitationTokenSecret,
  );
  const response = NextResponse.redirect(cleanAcceptanceUrl());
  response.cookies.set(INVITATION_ACCEPTANCE_COOKIE, cookieValue, {
    httpOnly: true,
    maxAge,
    path: INVITATION_ACCEPTANCE_COOKIE_PATH,
    sameSite: "lax",
    secure: webRuntimeEnv.appUrl.startsWith("https://"),
    expires: new Date(expiresAt * 1000),
  });
  return response;
}
