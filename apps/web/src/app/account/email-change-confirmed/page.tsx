import Link from "next/link";

import { Button } from "@/components/ui/button";
import { EmailChangeConfirmationStatus } from "./email-change-confirmation-status";

export default function EmailChangeConfirmedPage() {
  return (
    <main className="auth-shell auth-shell-single account-email-shell">
      <section className="auth-ledger" aria-labelledby="email-confirmed-title">
        <div className="auth-heading">
          <p className="ledger-kicker">Your account</p>
          <h1 id="email-confirmed-title">Continue your e-mail change</h1>
          <p>
            Check both inboxes for another confirmation message and follow that
            link too before you use the new address.
          </p>
        </div>
        <EmailChangeConfirmationStatus />
        <Button asChild className="mt-6">
          <Link href="/account">Open your account</Link>
        </Button>
      </section>
    </main>
  );
}
