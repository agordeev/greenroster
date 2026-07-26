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
          <p className="ledger-kicker">Secure return</p>
          <h1 id="recovery-title">Reset your password</h1>
          <p>
            Enter your account e-mail. The confirmation stays neutral so no one
            can use this form to discover who belongs to GreenRoster.
          </p>
        </div>
        {status === "expired" ? (
          <p className="form-message recovery-status" role="alert">
            This recovery link is expired or has already been used. Request a
            new one below.
          </p>
        ) : null}
        {status === "unavailable" ? (
          <p className="form-message recovery-status" role="alert">
            The recovery service could not be reached. Try opening your link
            again in a moment.
          </p>
        ) : null}
        <RecoveryForm />
      </section>
    </main>
  );
}
