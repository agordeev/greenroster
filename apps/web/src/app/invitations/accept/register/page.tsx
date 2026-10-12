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

function RegisterFrame({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <main className="auth-shell auth-shell-single invitation-shell">
      <section className="auth-ledger" aria-labelledby="register-title">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">
            GR
          </span>
          <div>
            <p className="eyebrow">GreenRoster</p>
            <p className="brand-note">Create your account</p>
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
        <div className="auth-heading">
          <p className="ledger-kicker">Invitation</p>
          <h1 id="register-title">Invitation link unavailable</h1>
          <p>
            Open the original invitation link again or ask a coordinator to
            resend it.
          </p>
        </div>
        <Link className="secondary-link" href="/help">
          Get help
        </Link>
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
        <div className="auth-heading">
          <p className="ledger-kicker">Invitation</p>
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
        <div className="auth-heading">
          <p className="ledger-kicker">Already signed in</p>
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
      <div className="auth-heading">
        <p className="ledger-kicker">Invitation</p>
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
