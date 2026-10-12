import { ResetForm } from "./reset-form";
import { MINIMUM_PASSWORD_LENGTH } from "@/lib/auth/auth-validation";

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
          <p className="ledger-kicker">One-time link</p>
          <h1 id="reset-title">Choose a new password</h1>
          <p>
            Use a passphrase of at least {MINIMUM_PASSWORD_LENGTH} characters.
            This link can only be used to change your password.
          </p>
        </div>
        <ResetForm />
      </section>
    </main>
  );
}
