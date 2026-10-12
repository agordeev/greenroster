import Link from "next/link";

import { Button } from "@/components/ui/button";
import { EmailChangeConfirmationStatus } from "./email-change-confirmation-status";
import { Kicker } from "@/components/blocks";

export default function EmailChangeConfirmedPage() {
  return (
    <main className="p-8 min-h-screen grid grid-cols-[minmax(20rem,38rem)] place-content-center max-[800px]:grid-cols-[1fr] max-[480px]:p-0 [&_[data-slot=auth-ledger]]:border [&_[data-slot=auth-ledger]]:min-h-auto [&_[data-slot=auth-ledger]]:max-w-176 max-[480px]:[&_[data-slot=auth-ledger]]:border-0!">
      <section
        className="p-[clamp(2rem,7vw,6rem)] border-r flex min-h-screen flex-col justify-center bg-card max-[800px]:border-r-0 max-[800px]:min-h-auto max-[480px]:p-6 [&>[data-slot=text-link]]:mt-5 [&>[data-slot=text-link]]:inline-block"
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
