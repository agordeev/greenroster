import Link from "next/link";
import { redirect } from "next/navigation";

import { signOutAction } from "@/app/actions/auth";
import { resolveAccountPageSession } from "@/lib/auth/account-page-session";
import { signInPath } from "@/lib/auth/safe-return-path";

import { AccountEmailForm } from "./account-email-form";

export default async function AccountPage() {
  const session = await resolveAccountPageSession();
  if (session.state === "authentication_required")
    redirect(signInPath("/account"));
  if (session.state === "recovery_active") redirect("/reset-password");
  if (session.state === "recovery_restricted")
    return <RecoverySessionRestricted />;
  if (session.state === "unavailable") return <AccountUnavailable />;

  return (
    <main className="auth-shell auth-shell-single account-email-shell">
      <section className="auth-ledger" aria-labelledby="account-title">
        <div className="auth-heading">
          <p className="ledger-kicker">Account security</p>
          <h1 id="account-title">Account e-mail</h1>
          <p>
            Your verified account e-mail is the single address GreenRoster uses
            for sign-in, recovery, and product notifications.
          </p>
        </div>
        <AccountEmailForm currentEmail={session.email} />
        <div className="account-email-actions">
          <Link className="secondary-link" href="/portal">
            Return to GreenRoster
          </Link>
          <form action={signOutAction}>
            <button className="text-button" type="submit">
              Sign out
            </button>
          </form>
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
        <h1>Sign in again to change your account e-mail</h1>
        <p>
          This password-recovery session cannot change account details. Sign
          out, then sign in normally before requesting an e-mail change.
        </p>
        <form action={signOutAction}>
          <button className="primary-button" type="submit">
            Sign out
          </button>
        </form>
      </section>
    </main>
  );
}

function AccountUnavailable() {
  return (
    <main className="auth-shell auth-shell-single account-email-shell">
      <section className="auth-ledger">
        <p className="ledger-kicker">Account security</p>
        <h1>Account details could not be loaded</h1>
        <p>Try again in a moment or contact support.</p>
      </section>
    </main>
  );
}
