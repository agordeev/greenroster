import Link from "next/link";

import { EmailChangeConfirmationStatus } from "./email-change-confirmation-status";

export default function EmailChangeConfirmedPage() {
  return (
    <main className="auth-shell auth-shell-single account-email-shell">
      <section className="auth-ledger" aria-labelledby="email-confirmed-title">
        <div className="auth-heading">
          <p className="ledger-kicker">Account security</p>
          <h1 id="email-confirmed-title">Continue your e-mail change</h1>
          <p>
            If you arrived from a confirmation link, that confirmation step was
            submitted to the account provider. Complete any other confirmation
            message the provider requires before using the new address.
          </p>
        </div>
        <EmailChangeConfirmationStatus />
        <Link className="primary-link" href="/account">
          Open Account
        </Link>
      </section>
    </main>
  );
}
