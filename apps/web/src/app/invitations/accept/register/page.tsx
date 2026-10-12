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
import { Kicker, TextLink } from "@/components/blocks";

function RegisterFrame({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <main className="p-8 min-h-screen grid grid-cols-[minmax(20rem,38rem)] place-content-center max-[800px]:grid-cols-[1fr] max-[480px]:p-0 [&_[data-slot=auth-ledger]]:border [&_[data-slot=auth-ledger]]:min-h-auto [&_[data-slot=auth-ledger]]:w-[min(100%,52rem)] max-[480px]:[&_[data-slot=auth-ledger]]:border-0! max-[480px]:[&_[data-slot=auth-ledger]]:w-full!">
      <section
        className="p-[clamp(2rem,7vw,6rem)] border-r flex min-h-screen flex-col justify-center bg-card max-[800px]:border-r-0 max-[800px]:min-h-auto max-[480px]:p-6 [&>[data-slot=text-link]]:mt-5 [&>[data-slot=text-link]]:inline-block"
        data-slot="auth-ledger"
        aria-labelledby="register-title"
      >
        <div className="mb-[clamp(3rem,9vh,6.5rem)] gap-3.5 flex items-center max-[800px]:mb-12">
          <span
            className="border border-primary grid w-12 h-12 place-items-center rounded-full text-primary text-[0.875rem] font-bold tracking-[0.08em]"
            aria-hidden="true"
          >
            GR
          </span>
          <div>
            <p className="m-0 text-[1.125rem] font-bold">GreenRoster</p>
            <p className="mx-0 mt-0.5 mb-0 text-muted-foreground text-[0.8125rem]">
              Create your account
            </p>
          </div>
        </div>
        {children}
      </section>
    </main>
  );
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
