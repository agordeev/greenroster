import Link from "next/link";
import { cookies } from "next/headers";

import {
  INVITATION_ACCEPTANCE_COOKIE,
  readInvitationAcceptanceCookieValue,
} from "@/lib/invitations/invitation-acceptance-state";
import { webRuntimeEnv } from "@/lib/runtime-env";
import { createServerComponentSupabaseClient } from "@/lib/supabase/server-component-client";

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
            <p className="brand-note">Invitation account setup</p>
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
          <p className="ledger-kicker">Membership invitation</p>
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
          <p className="ledger-kicker">Membership invitation</p>
          <h1 id="register-title">Account service unavailable</h1>
          <p>
            Try again in a moment. Your protected invitation handoff remains in
            this browser.
          </p>
        </div>
      </RegisterFrame>
    );
  }
  if (!userResult.error && userResult.data.user) {
    return (
      <RegisterFrame>
        <div className="auth-heading">
          <p className="ledger-kicker">Verified account</p>
          <h1 id="register-title">Continue with your signed-in account</h1>
          <p>
            This browser already has a session. Review the invitation before
            accepting it; creating another account here would not attach to this
            session.
          </p>
        </div>
        <Link className="primary-link" href="/invitations/accept">
          Review invitation
        </Link>
      </RegisterFrame>
    );
  }

  return (
    <RegisterFrame>
      <div className="auth-heading">
        <p className="ledger-kicker">Membership invitation</p>
        <h1 id="register-title">Create your GreenRoster account</h1>
        <p>
          Use an e-mail address you control and a passphrase of at least 12
          characters. We keep this confirmation neutral so account discovery is
          not exposed.
        </p>
      </div>
      <InvitationRegisterForm />
    </RegisterFrame>
  );
}
