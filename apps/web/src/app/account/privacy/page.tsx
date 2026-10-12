import Link from "next/link";
import { redirect } from "next/navigation";

import { resolveAccountPageSession } from "@/lib/auth/account-page-session";
import { signInPath } from "@/lib/auth/safe-return-path";
import { webRuntimeEnv } from "@/lib/runtime-env";
import { buildPrivacyRequestMailto } from "@/lib/privacy/privacy-request-links";
import { hasRecentPrivacyAuthentication } from "@/lib/privacy/privacy-request-auth";
import { Button } from "@/components/ui/button";
import { Kicker, TextLink } from "@/components/blocks";

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
    <main className="p-8 min-h-screen grid grid-cols-[minmax(20rem,38rem)] place-content-center max-[800px]:grid-cols-[1fr] max-[480px]:p-0 [&_[data-slot=auth-ledger]]:border [&_[data-slot=auth-ledger]]:min-h-auto [&_[data-slot=auth-ledger]]:max-w-176 max-[480px]:[&_[data-slot=auth-ledger]]:border-0!">
      <section
        className="p-[clamp(2rem,7vw,6rem)] border-r flex min-h-screen flex-col justify-center bg-card max-[800px]:border-r-0 max-[800px]:min-h-auto max-[480px]:p-6 [&>[data-slot=text-link]]:mt-5 [&>[data-slot=text-link]]:inline-block"
        data-slot="auth-ledger"
        aria-labelledby="privacy-requests-title"
      >
        <div className="max-w-136 [&>p:last-child]:text-muted-foreground [&>p:last-child]:leading-[1.65] [&_h1]:mx-0 [&_h1]:mt-2 [&_h1]:mb-3.5 [&_h1]:text-[length:clamp(2rem,4vw,3rem)] [&_h1]:font-semibold [&_h1]:tracking-[-0.02em] [&_h1]:leading-[1.1] [&_p]:m-0">
          <Kicker>Privacy</Kicker>
          <h1 id="privacy-requests-title">Privacy requests</h1>
          <p>Choose a request below. We aim to reply within 30 days.</p>
        </div>
        <div className="mt-6 gap-4 flex items-center justify-between max-[600px]:items-stretch max-[600px]:flex-col">
          <Button asChild>
            <a href={dataAccessHref}>Request a copy of my data</a>
          </Button>
          <a
            className="justify-self-start text-primary text-[0.875rem] font-bold underline-offset-[0.2em] focus-visible:outline-[3px] focus-visible:outline-solid focus-visible:outline-ring focus-visible:outline-offset-[3px]"
            data-slot="text-link"
            href={deletionHref}
          >
            Request account deletion
          </a>
        </div>
        <div className="mt-6 gap-4 flex items-center justify-between max-[600px]:items-stretch max-[600px]:flex-col">
          <TextLink href="/account">Return to account</TextLink>
          <TextLink href="/privacy">Read the Privacy Policy</TextLink>
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
    <main className="p-8 min-h-screen grid grid-cols-[minmax(20rem,38rem)] place-content-center max-[800px]:grid-cols-[1fr] max-[480px]:p-0 [&_[data-slot=auth-ledger]]:border [&_[data-slot=auth-ledger]]:min-h-auto [&_[data-slot=auth-ledger]]:max-w-176 max-[480px]:[&_[data-slot=auth-ledger]]:border-0!">
      <section
        className="p-[clamp(2rem,7vw,6rem)] border-r flex min-h-screen flex-col justify-center bg-card max-[800px]:border-r-0 max-[800px]:min-h-auto max-[480px]:p-6 [&>[data-slot=text-link]]:mt-5 [&>[data-slot=text-link]]:inline-block"
        data-slot="auth-ledger"
      >
        <Kicker>Privacy</Kicker>
        <h1>Privacy requests are temporarily unavailable</h1>
        <p>Try again in a moment or contact GreenRoster support.</p>
      </section>
    </main>
  );
}

function RecentAuthenticationRequired() {
  return (
    <main className="p-8 min-h-screen grid grid-cols-[minmax(20rem,38rem)] place-content-center max-[800px]:grid-cols-[1fr] max-[480px]:p-0 [&_[data-slot=auth-ledger]]:border [&_[data-slot=auth-ledger]]:min-h-auto [&_[data-slot=auth-ledger]]:max-w-176 max-[480px]:[&_[data-slot=auth-ledger]]:border-0!">
      <section
        className="p-[clamp(2rem,7vw,6rem)] border-r flex min-h-screen flex-col justify-center bg-card max-[800px]:border-r-0 max-[800px]:min-h-auto max-[480px]:p-6 [&>[data-slot=text-link]]:mt-5 [&>[data-slot=text-link]]:inline-block"
        data-slot="auth-ledger"
      >
        <Kicker>One more step</Kicker>
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
