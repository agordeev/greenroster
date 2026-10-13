import Link from "next/link";

import { Button } from "@/components/ui/button";
import { EmailChangeConfirmationStatus } from "./email-change-confirmation-status";
import {
  Kicker,
  standalonePageClass,
  standalonePanelClass,
} from "@/components/blocks";

export default function EmailChangeConfirmedPage() {
  return (
    <main className={standalonePageClass}>
      <section
        className={standalonePanelClass}
        data-slot="auth-ledger"
        aria-labelledby="email-confirmed-title"
      >
        <div className="max-w-136 [&>p:last-child]:text-muted-foreground [&>p:last-child]:leading-[1.65] [&_h1]:mx-0 [&_h1]:mt-2 [&_h1]:mb-3.5 [&_h1]:text-[length:clamp(2rem,4vw,3rem)] [&_h1]:font-semibold [&_h1]:tracking-[-0.02em] [&_h1]:leading-[1.1] [&_p]:m-0">
          <Kicker>Your account</Kicker>
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
