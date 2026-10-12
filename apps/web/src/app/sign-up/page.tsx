import Link from "next/link";

import { resolveCurrentLegalDocuments } from "@/lib/auth/organizer-signup-data";

import { OrganizerSignupForm } from "./signup-form";
import { FormMessage, SkipLink } from "@/components/blocks";

type SignupPageProps = {
  searchParams: Promise<{ status?: string }>;
};

export default async function SignupPage({ searchParams }: SignupPageProps) {
  const { status } = await searchParams;
  const legal = await resolveCurrentLegalDocuments();

  return (
    <>
      <SkipLink />
      <main
        id="main-content"
        tabIndex={-1}
        className="auth-shell auth-shell-single"
      >
        <section className="auth-ledger" aria-labelledby="sign-up-title">
          <div className="brand-lockup">
            <span className="brand-mark" aria-hidden="true">
              GR
            </span>
            <div>
              <p className="eyebrow">GreenRoster</p>
              <p className="brand-note">Your group. Your rounds. One roster.</p>
            </div>
          </div>

          <div className="auth-heading">
            <p className="ledger-kicker">New group</p>
            <h1 id="sign-up-title">Start your group</h1>
            <p>Create your account, then set up your group.</p>
          </div>

          {status === "auth-unavailable" ? (
            <FormMessage className="mt-6 max-w-[30rem]" role="alert">
              We couldn&apos;t create your account. Try again in a moment.
            </FormMessage>
          ) : status === "expired" ? (
            <FormMessage className="mt-6 max-w-[30rem]" role="alert">
              Your verification link has expired. Start again to receive a new
              link.
            </FormMessage>
          ) : null}

          {legal ? (
            <OrganizerSignupForm />
          ) : (
            <FormMessage role="alert">
              <p>
                You can&apos;t create a group yet. Our Terms of Use and Privacy
                Policy aren&apos;t published.
              </p>
              <p>
                The sign-up form will appear here once the{" "}
                <Link href="/terms">Terms of Use</Link> and{" "}
                <Link href="/privacy">Privacy Policy</Link> are published.
              </p>
            </FormMessage>
          )}

          <Link className="secondary-link" href="/sign-in">
            Sign in instead
          </Link>
        </section>
      </main>
    </>
  );
}
