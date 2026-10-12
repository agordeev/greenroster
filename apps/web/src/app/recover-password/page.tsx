import { RecoveryForm } from "./recovery-form";

type RecoverPasswordPageProps = {
  searchParams: Promise<{ status?: string }>;
};

export default async function RecoverPasswordPage({
  searchParams,
}: RecoverPasswordPageProps) {
  const { status } = await searchParams;

  return (
    <main className="auth-shell auth-shell-single">
      <section className="auth-ledger" aria-labelledby="recovery-title">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">
            GR
          </span>
          <div>
            <p className="eyebrow">GreenRoster</p>
            <p className="brand-note">Account recovery</p>
          </div>
        </div>
        <div className="auth-heading">
          <p className="ledger-kicker">Password help</p>
          <h1 id="recovery-title">Reset your password</h1>
          <p>Enter your account e-mail and we’ll send you a recovery link.</p>
        </div>
        {status === "expired" ? (
          <p className="form-message recovery-status" role="alert">
            This recovery link has expired or was already used. Enter your
            e-mail below to get a new one.
          </p>
        ) : null}
        {status === "unavailable" ? (
          <p className="form-message recovery-status" role="alert">
            We could not open your recovery link just now. Open it again in a
            moment.
          </p>
        ) : null}
        <RecoveryForm />
      </section>
    </main>
  );
}
