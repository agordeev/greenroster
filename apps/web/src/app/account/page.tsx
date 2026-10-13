import { redirect } from "next/navigation";

import { signOutAction } from "@/app/actions/auth";
import { resolveAccountPageSession } from "@/lib/auth/account-page-session";
import { signInPath } from "@/lib/auth/safe-return-path";
import { Button } from "@/components/ui/button";

import { AccountEmailForm } from "./account-email-form";
import {
  BrandLockup,
  Kicker,
  standalonePageClass,
  standalonePanelClass,
  TextLink,
} from "@/components/blocks";

export default async function AccountPage() {
  const session = await resolveAccountPageSession();
  if (session.state === "authentication_required")
    redirect(signInPath("/account"));
  if (session.state === "recovery_active") redirect("/reset-password");
  if (session.state === "recovery_restricted")
    return <RecoverySessionRestricted />;
  if (session.state === "unavailable") return <AccountUnavailable />;

  return (
    <main className={standalonePageClass}>
      <section
        className={standalonePanelClass}
        data-slot="auth-ledger"
        aria-labelledby="account-title"
      >
        <BrandLockup className="mb-10" />
        <div className="max-w-136 [&>p:last-child]:text-muted-foreground [&>p:last-child]:leading-[1.65] [&_h1]:mx-0 [&_h1]:mt-2 [&_h1]:mb-3.5 [&_h1]:text-[length:clamp(2rem,4vw,3rem)] [&_h1]:font-semibold [&_h1]:tracking-[-0.02em] [&_h1]:leading-[1.1] [&_p]:m-0">
          <Kicker>Your account</Kicker>
          <h1 id="account-title">Account e-mail</h1>
          <p>
            You sign in with this e-mail address. We also use it for password
            recovery and GreenRoster notifications.
          </p>
        </div>
        <AccountEmailForm currentEmail={session.email} />
        <div className="mt-8 flex flex-wrap items-baseline gap-x-6 gap-y-3">
          <TextLink href="/portal">Return to GreenRoster</TextLink>
          <TextLink href="/account/privacy">Privacy requests</TextLink>
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
    <main className={standalonePageClass}>
      <section className={standalonePanelClass} data-slot="auth-ledger">
        <Kicker>One more step</Kicker>
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
    <main className={standalonePageClass}>
      <section className={standalonePanelClass} data-slot="auth-ledger">
        <Kicker>Your account</Kicker>
        <h1>We could not load your account</h1>
        <p>Try again in a moment or contact support.</p>
      </section>
    </main>
  );
}
