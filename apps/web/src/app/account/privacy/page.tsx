import Link from "next/link";
import { redirect } from "next/navigation";

import { resolveAccountPageSession } from "@/lib/auth/account-page-session";
import { signInPath } from "@/lib/auth/safe-return-path";
import { webRuntimeEnv } from "@/lib/runtime-env";
import { buildPrivacyRequestMailto } from "@/lib/privacy/privacy-request-links";
import { hasRecentPrivacyAuthentication } from "@/lib/privacy/privacy-request-auth";
import { Button } from "@/components/ui/button";

export default async function PrivacyRequestsPage() {
  const session = await resolveAccountPageSession();
  if (session.state === "authentication_required") {
    redirect(signInPath("/account/privacy"));
  }
  if (session.state === "recovery_active") redirect("/reset-password");
  if (session.state === "recovery_restricted")
    return <RecoverySessionRestricted />;
  if (session.state === "unavailable") return <PrivacyUnavailable />;
  if (!hasRecentPrivacyAuthentication(session.sessionStartedAt)) {
    return <RecentAuthenticationRequired />;
  }

  const dataAccessHref = buildPrivacyRequestMailto(
    webRuntimeEnv.supportEmail,
    session.email,
    "data_access",
  );
  const deletionHref = buildPrivacyRequestMailto(
    webRuntimeEnv.supportEmail,
    session.email,
    "account_deletion",
  );

  return (
    <main className="auth-shell auth-shell-single account-email-shell">
      <section className="auth-ledger" aria-labelledby="privacy-requests-title">
        <div className="auth-heading">
          <p className="ledger-kicker">Privacy</p>
          <h1 id="privacy-requests-title">Privacy requests</h1>
          <p>Choose a request below. We aim to reply within 30 days.</p>
        </div>
        <div className="account-email-actions">
          <Button asChild>
            <a href={dataAccessHref}>Request a copy of my data</a>
          </Button>
          <a className="secondary-link" href={deletionHref}>
            Request account deletion
          </a>
        </div>
        <div className="account-email-actions">
          <Link className="secondary-link" href="/account">
            Return to account
          </Link>
          <Link className="secondary-link" href="/privacy">
            Read the Privacy Policy
          </Link>
        </div>
      </section>
    </main>
  );
}

function RecoverySessionRestricted() {
  return (
    <main className="auth-shell auth-shell-single account-email-shell">
      <section className="auth-ledger">
        <p className="ledger-kicker">One more step</p>
        <h1>Sign in again to make a privacy request</h1>
        <p>Sign out, then sign in with your password.</p>
        <Button asChild>
          <Link href="/sign-in?next=%2Faccount%2Fprivacy">
            Return to sign in
          </Link>
        </Button>
      </section>
    </main>
  );
}

function PrivacyUnavailable() {
  return (
    <main className="auth-shell auth-shell-single account-email-shell">
      <section className="auth-ledger">
        <p className="ledger-kicker">Privacy</p>
        <h1>Privacy requests are temporarily unavailable</h1>
        <p>Try again in a moment or contact GreenRoster support.</p>
      </section>
    </main>
  );
}

function RecentAuthenticationRequired() {
  return (
    <main className="auth-shell auth-shell-single account-email-shell">
      <section className="auth-ledger">
        <p className="ledger-kicker">One more step</p>
        <h1>Sign in again to make a privacy request</h1>
        <p>Sign out, then sign in again to send one.</p>
        <Button asChild>
          <Link href="/sign-in?next=%2Faccount%2Fprivacy">
            Return to sign in
          </Link>
        </Button>
      </section>
    </main>
  );
}
