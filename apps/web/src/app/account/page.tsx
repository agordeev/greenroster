import { redirect } from "next/navigation";

import { signOutAction } from "@/app/actions/auth";
import { resolveAccountPageSession } from "@/lib/auth/account-page-session";
import { signInPath } from "@/lib/auth/safe-return-path";
import { Button } from "@/components/ui/button";

import { AccountEmailForm } from "./account-email-form";
import { Kicker, TextLink } from "@/components/blocks";

export default async function AccountPage() {
  const session = await resolveAccountPageSession();
  if (session.state === "authentication_required")
    redirect(signInPath("/account"));
  if (session.state === "recovery_active") redirect("/reset-password");
  if (session.state === "recovery_restricted")
    return <RecoverySessionRestricted />;
  if (session.state === "unavailable") return <AccountUnavailable />;

  return (
    <main className="p-8 min-h-screen grid grid-cols-[minmax(20rem,38rem)] place-content-center max-[800px]:grid-cols-[1fr] max-[480px]:p-0 [&_[data-slot=auth-ledger]]:border [&_[data-slot=auth-ledger]]:min-h-auto [&_[data-slot=auth-ledger]]:max-w-176 max-[480px]:[&_[data-slot=auth-ledger]]:border-0!">
      <section
        className="p-[clamp(2rem,7vw,6rem)] border-r flex min-h-screen flex-col justify-center bg-card max-[800px]:border-r-0 max-[800px]:min-h-auto max-[480px]:p-6 [&>[data-slot=text-link]]:mt-5 [&>[data-slot=text-link]]:inline-block"
        data-slot="auth-ledger"
        aria-labelledby="account-title"
      >
        <div className="max-w-136 [&>p:last-child]:text-muted-foreground [&>p:last-child]:leading-[1.65] [&_h1]:mx-0 [&_h1]:mt-2 [&_h1]:mb-3.5 [&_h1]:text-[length:clamp(2rem,4vw,3rem)] [&_h1]:font-semibold [&_h1]:tracking-[-0.02em] [&_h1]:leading-[1.1] [&_p]:m-0">
          <Kicker>Your account</Kicker>
          <h1 id="account-title">Account e-mail</h1>
          <p>
            You sign in with this e-mail address. We also use it for password
            recovery and GreenRoster notifications.
          </p>
        </div>
        <AccountEmailForm currentEmail={session.email} />
        <div className="mt-6 gap-4 flex items-center justify-between max-[600px]:items-stretch max-[600px]:flex-col">
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
    <main className="p-8 min-h-screen grid grid-cols-[minmax(20rem,38rem)] place-content-center max-[800px]:grid-cols-[1fr] max-[480px]:p-0 [&_[data-slot=auth-ledger]]:border [&_[data-slot=auth-ledger]]:min-h-auto [&_[data-slot=auth-ledger]]:max-w-176 max-[480px]:[&_[data-slot=auth-ledger]]:border-0!">
      <section
        className="p-[clamp(2rem,7vw,6rem)] border-r flex min-h-screen flex-col justify-center bg-card max-[800px]:border-r-0 max-[800px]:min-h-auto max-[480px]:p-6 [&>[data-slot=text-link]]:mt-5 [&>[data-slot=text-link]]:inline-block"
        data-slot="auth-ledger"
      >
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
    <main className="p-8 min-h-screen grid grid-cols-[minmax(20rem,38rem)] place-content-center max-[800px]:grid-cols-[1fr] max-[480px]:p-0 [&_[data-slot=auth-ledger]]:border [&_[data-slot=auth-ledger]]:min-h-auto [&_[data-slot=auth-ledger]]:max-w-176 max-[480px]:[&_[data-slot=auth-ledger]]:border-0!">
      <section
        className="p-[clamp(2rem,7vw,6rem)] border-r flex min-h-screen flex-col justify-center bg-card max-[800px]:border-r-0 max-[800px]:min-h-auto max-[480px]:p-6 [&>[data-slot=text-link]]:mt-5 [&>[data-slot=text-link]]:inline-block"
        data-slot="auth-ledger"
      >
        <Kicker>Your account</Kicker>
        <h1>We could not load your account</h1>
        <p>Try again in a moment or contact support.</p>
      </section>
    </main>
  );
}
