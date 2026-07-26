import { AuthForm } from "./auth-form";
import { resolveSafeReturnPath } from "@/lib/auth/safe-return-path";

type SignInPageProps = {
  searchParams: Promise<{ next?: string; status?: string }>;
};

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const { next, status } = await searchParams;
  const returnPath = resolveSafeReturnPath(next);

  return (
    <main className="auth-shell">
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
            Use your verified account e-mail. GreenRoster never uses a shared
            group password or a separate administrator unlock.
          </p>
        </div>

        {status === "session-expired" ? (
          <p className="form-message recovery-status" role="alert">
            Your session expired. Sign in and try again.
          </p>
        ) : null}

        <AuthForm returnPath={returnPath} />
      </section>

      <aside className="auth-context" aria-label="GreenRoster product context">
        <div className="scorecard-rule" />
        <p className="context-number">01</p>
        <h2>Person-specific access keeps every group isolated.</h2>
        <p>
          Your role and group come from the membership stored on the server—not
          from a link, browser field, or group selector.
        </p>
        <dl>
          <div>
            <dt>Identity</dt>
            <dd>Supabase Auth</dd>
          </div>
          <div>
            <dt>Tenant</dt>
            <dd>One group in v1</dd>
          </div>
          <div>
            <dt>Authority</dt>
            <dd>Server resolved</dd>
          </div>
        </dl>
      </aside>
    </main>
  );
}
