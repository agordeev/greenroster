import { ResetForm } from "./reset-form";

export default function ResetPasswordPage() {
  return (
    <main className="auth-shell auth-shell-single">
      <section className="auth-ledger" aria-labelledby="reset-title">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">
            GR
          </span>
          <div>
            <p className="eyebrow">GreenRoster</p>
            <p className="brand-note">Protected account change</p>
          </div>
        </div>
        <div className="auth-heading">
          <p className="ledger-kicker">Single-use recovery</p>
          <h1 id="reset-title">Choose a new password</h1>
          <p>
            Use a passphrase of at least 12 characters. This link authorizes
            only the password change.
          </p>
        </div>
        <ResetForm />
      </section>
    </main>
  );
}
