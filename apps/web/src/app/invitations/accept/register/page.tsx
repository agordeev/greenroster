import Link from "next/link";
import { cookies } from "next/headers";

import {
  INVITATION_ACCEPTANCE_COOKIE,
  readInvitationAcceptanceCookieValue,
} from "@/lib/invitations/invitation-acceptance-state";
import { MINIMUM_PASSWORD_LENGTH } from "@/lib/auth/auth-validation";
import { webRuntimeEnv } from "@/lib/runtime-env";
import { createServerComponentSupabaseClient } from "@/lib/supabase/server-component-client";
import { Button } from "@/components/ui/button";

import { InvitationRegisterForm } from "./register-form";
import { AuthPanel, Kicker, TextLink } from "@/components/blocks";

function RegisterFrame({ children }: Readonly<{ children: React.ReactNode }>) {
  return <AuthPanel titleId="register-title">{children}</AuthPanel>;
}

export default async function InvitationRegisterPage() {
  const cookieStore = await cookies();
  const invitation = readInvitationAcceptanceCookieValue(
    cookieStore.get(INVITATION_ACCEPTANCE_COOKIE)?.value,
    webRuntimeEnv.invitationTokenSecret,
  );
  if (!invitation) {
    return (
      <RegisterFrame>
        <div className="max-w-136 [&>p:last-child]:text-muted-foreground [&>p:last-child]:leading-[1.65] [&_h1]:mx-0 [&_h1]:mt-2 [&_h1]:mb-3.5 [&_h1]:text-[length:clamp(2rem,4vw,3rem)] [&_h1]:font-semibold [&_h1]:tracking-[-0.02em] [&_h1]:leading-[1.1] [&_p]:m-0">
          <Kicker>Invitation</Kicker>
          <h1 id="register-title">Invitation link unavailable</h1>
          <p>
            Open the original invitation link again or ask a coordinator to
            resend it.
          </p>
        </div>
        <TextLink href="/help">Get help</TextLink>
      </RegisterFrame>
    );
  }

  const supabase = await createServerComponentSupabaseClient();
  let userResult: Awaited<ReturnType<typeof supabase.auth.getUser>>;
  try {
    userResult = await supabase.auth.getUser();
  } catch {
    return (
      <RegisterFrame>
        <div className="max-w-136 [&>p:last-child]:text-muted-foreground [&>p:last-child]:leading-[1.65] [&_h1]:mx-0 [&_h1]:mt-2 [&_h1]:mb-3.5 [&_h1]:text-[length:clamp(2rem,4vw,3rem)] [&_h1]:font-semibold [&_h1]:tracking-[-0.02em] [&_h1]:leading-[1.1] [&_p]:m-0">
          <Kicker>Invitation</Kicker>
          <h1 id="register-title">We couldn&apos;t check your account</h1>
          <p>
            Try again in a moment. Your invitation is still open in this
            browser.
          </p>
        </div>
      </RegisterFrame>
    );
  }
  if (!userResult.error && userResult.data.user) {
    return (
      <RegisterFrame>
        <div className="max-w-136 [&>p:last-child]:text-muted-foreground [&>p:last-child]:leading-[1.65] [&_h1]:mx-0 [&_h1]:mt-2 [&_h1]:mb-3.5 [&_h1]:text-[length:clamp(2rem,4vw,3rem)] [&_h1]:font-semibold [&_h1]:tracking-[-0.02em] [&_h1]:leading-[1.1] [&_p]:m-0">
          <Kicker>Already signed in</Kicker>
          <h1 id="register-title">You already have an account</h1>
          <p>
            You&apos;re already signed in on this browser. Check the invitation
            and accept it with this one.
          </p>
        </div>
        <Button asChild className="mt-6">
          <Link href="/invitations/accept">Review invitation</Link>
        </Button>
      </RegisterFrame>
    );
  }

  return (
    <RegisterFrame>
      <div className="max-w-136 [&>p:last-child]:text-muted-foreground [&>p:last-child]:leading-[1.65] [&_h1]:mx-0 [&_h1]:mt-2 [&_h1]:mb-3.5 [&_h1]:text-[length:clamp(2rem,4vw,3rem)] [&_h1]:font-semibold [&_h1]:tracking-[-0.02em] [&_h1]:leading-[1.1] [&_p]:m-0">
        <Kicker>Invitation</Kicker>
        <h1 id="register-title">Create your GreenRoster account</h1>
        <p>
          Use an e-mail address you can open and a password of at least{" "}
          {MINIMUM_PASSWORD_LENGTH} characters.
        </p>
      </div>
      <InvitationRegisterForm />
    </RegisterFrame>
  );
}
