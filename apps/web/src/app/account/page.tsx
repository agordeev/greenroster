import Link from "next/link";
import { redirect } from "next/navigation";

import { signOutAction } from "@/app/actions/auth";
import { resolveAccountPageSession } from "@/lib/auth/account-page-session";
import { signInPath } from "@/lib/auth/safe-return-path";
import { Button } from "@/components/ui/button";

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
          <p className="ledger-kicker">Your account</p>
          <h1 id="account-title">Account e-mail</h1>
          <p>
            You sign in with this e-mail address. We also use it for password
            recovery and GreenRoster notifications.
          </p>
        </div>
        <AccountEmailForm currentEmail={session.email} />
        <div className="account-email-actions">
          <Link className="secondary-link" href="/portal">
            Return to GreenRoster
          </Link>
          <Link className="secondary-link" href="/account/privacy">
            Privacy requests
          </Link>
          <form action={signOutAction}>
            <Button variant="link" size="inline" type="submit">
              Sign out
            </Button>
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
        <p className="ledger-kicker">One more step</p>
        <h1>Sign in again to change your account e-mail</h1>
        <p>Sign out, then sign in with your password.</p>
        <form action={signOutAction}>
          <Button type="submit">Sign out</Button>
        </form>
      </section>
    </main>
  );
}

function AccountUnavailable() {
  return (
    <main className="auth-shell auth-shell-single account-email-shell">
      <section className="auth-ledger">
        <p className="ledger-kicker">Your account</p>
        <h1>We could not load your account</h1>
        <p>Try again in a moment or contact support.</p>
      </section>
    </main>
  );
}
