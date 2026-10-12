import Link from "next/link";

import { AuthForm } from "./auth-form";
import { ActionRow, FormMessage, SkipLink } from "@/components/blocks";
import { resolveSafeReturnPath } from "@/lib/auth/safe-return-path";

type SignInPageProps = {
  searchParams: Promise<{ next?: string; status?: string }>;
};

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const { next, status } = await searchParams;
  const returnPath = resolveSafeReturnPath(next);

  return (
    <>
      <SkipLink />
      <main id="main-content" tabIndex={-1} className="auth-shell">
        <section className="auth-ledger" aria-labelledby="sign-in-title">
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
            <p className="ledger-kicker">Welcome back</p>
            <h1 id="sign-in-title">Sign in to GreenRoster</h1>
            <p>Sign in to see your rounds and standings.</p>
          </div>

          {status === "session-expired" ? (
            <FormMessage className="mt-6 max-w-[30rem]" role="alert">
              You have been signed out. Sign in and try again.
            </FormMessage>
          ) : null}
          {status === "member-link-expired" ? (
            <FormMessage className="mt-6 max-w-[30rem]" role="alert">
              That results link has expired or was already used. Ask your group
              coordinator to send a new results e-mail.
            </FormMessage>
          ) : null}
          {status === "member-link-unavailable" ? (
            <FormMessage className="mt-6 max-w-[30rem]" role="alert">
              We could not open that results link. Try the link again, or sign
              in with your account e-mail.
            </FormMessage>
          ) : null}

          <AuthForm returnPath={returnPath} />
          <ActionRow>
            <Link className="secondary-link" href="/sign-up">
              Create your group
            </Link>
          </ActionRow>
        </section>

        <aside className="auth-context" aria-label="About GreenRoster">
          <div className="scorecard-rule" />
          <h2>Your next round, recent results, and where you stand.</h2>
          <dl>
            <div>
              <dt>Rounds</dt>
              <dd>RSVP for your next round</dd>
            </div>
            <div>
              <dt>Results</dt>
              <dd>See how you finished</dd>
            </div>
            <div>
              <dt>Standings</dt>
              <dd>Follow your quota and Order of Merit</dd>
            </div>
          </dl>
        </aside>
      </main>
    </>
  );
}
