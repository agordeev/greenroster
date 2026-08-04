import Link from "next/link";
import { redirect } from "next/navigation";

import { resolveAccountPageSession } from "@/lib/auth/account-page-session";
import { signInPath } from "@/lib/auth/safe-return-path";
import { webRuntimeEnv } from "@/lib/runtime-env";
import { buildPrivacyRequestMailto } from "@/lib/privacy/privacy-request-links";
import { hasRecentPrivacyAuthentication } from "@/lib/privacy/privacy-request-auth";

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
          <p>
            Use this authenticated page to contact the named privacy owner
            through the GreenRoster support process. Requests target a response
            within 30 days; v1 does not keep an in-product request tracker.
          </p>
        </div>
        <div className="account-email-actions">
          <a className="primary-button" href={dataAccessHref}>
            Request a copy of my data
          </a>
          <a className="secondary-link" href={deletionHref}>
            Request account deletion
          </a>
        </div>
        <p className="status-note">
          For security, requests must start from a normal signed-in session, not
          password recovery. If your sign-in is no longer recent, sign out and
          sign in again before sending a request.
        </p>
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
        <p className="ledger-kicker">Regular session required</p>
        <h1>Sign in again to make a privacy request</h1>
        <p>
          This password-recovery session cannot submit a privacy request. Sign
          out, then sign in normally before contacting the privacy owner.
        </p>
        <Link
          className="primary-button"
          href="/sign-in?next=%2Faccount%2Fprivacy"
        >
          Return to sign in
        </Link>
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
        <p className="ledger-kicker">Recent sign-in required</p>
        <h1>Sign in again to make a privacy request</h1>
        <p>
          For your protection, data access and account deletion requests are
          available for 15 minutes after a normal sign-in. Sign out, then sign
          in again before contacting the privacy owner.
        </p>
        <Link
          className="primary-button"
          href="/sign-in?next=%2Faccount%2Fprivacy"
        >
          Return to sign in
        </Link>
      </section>
    </main>
  );
}
