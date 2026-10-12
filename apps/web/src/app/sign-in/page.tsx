import Link from "next/link";

import { AuthForm } from "./auth-form";
import { ActionRow } from "@/components/ui";
import { resolveSafeReturnPath } from "@/lib/auth/safe-return-path";

type SignInPageProps = {
  searchParams: Promise<{ next?: string; status?: string }>;
};

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const { next, status } = await searchParams;
  const returnPath = resolveSafeReturnPath(next);

  return (
    <>
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
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
            <p className="ledger-kicker">Clubhouse access</p>
            <h1 id="sign-in-title">Sign in as yourself</h1>
            <p>
              Use the e-mail address on your own account. There is no shared
              group password.
            </p>
          </div>

          {status === "session-expired" ? (
            <p className="form-message recovery-status" role="alert">
              You have been signed out. Sign in and try again.
            </p>
          ) : null}
          {status === "member-link-expired" ? (
            <p className="form-message recovery-status" role="alert">
              That results link has expired or was already used. Ask your group
              coordinator to send a new results e-mail.
            </p>
          ) : null}
          {status === "member-link-unavailable" ? (
            <p className="form-message recovery-status" role="alert">
              We could not open that results link. Try the link again, or sign
              in with your account e-mail.
            </p>
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
          <p className="context-number">01</p>
          <h2>Your access comes from your own membership.</h2>
          <p>
            Your role and group come from your membership, not from a link or a
            group selector.
          </p>
          <dl>
            <div>
              <dt>Sign-in</dt>
              <dd>Your account e-mail and password</dd>
            </div>
            <div>
              <dt>Groups</dt>
              <dd>One group for now</dd>
            </div>
            <div>
              <dt>Your role</dt>
              <dd>Set by your membership</dd>
            </div>
          </dl>
        </aside>
      </main>
    </>
  );
}
