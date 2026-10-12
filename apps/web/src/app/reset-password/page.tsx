import { ResetForm } from "./reset-form";
import { MINIMUM_PASSWORD_LENGTH } from "@/lib/auth/auth-validation";
import { Kicker } from "@/components/blocks";

export default function ResetPasswordPage() {
  return (
    <main className="p-8 min-h-screen grid grid-cols-[minmax(20rem,38rem)] place-content-center max-[800px]:grid-cols-[1fr] max-[480px]:p-0 [&_[data-slot=auth-ledger]]:border [&_[data-slot=auth-ledger]]:min-h-auto max-[480px]:[&_[data-slot=auth-ledger]]:border-0!">
      <section
        className="p-[clamp(2rem,7vw,6rem)] border-r flex min-h-screen flex-col justify-center bg-card max-[800px]:border-r-0 max-[800px]:min-h-auto max-[480px]:p-6 [&>[data-slot=text-link]]:mt-5 [&>[data-slot=text-link]]:inline-block"
        data-slot="auth-ledger"
        aria-labelledby="reset-title"
      >
        <div className="mb-[clamp(3rem,9vh,6.5rem)] gap-3.5 flex items-center max-[800px]:mb-12">
          <span
            className="border border-primary grid w-12 h-12 place-items-center rounded-full text-primary text-[0.875rem] font-bold tracking-[0.08em]"
            aria-hidden="true"
          >
            GR
          </span>
          <div>
            <p className="m-0 text-[1.125rem] font-bold">GreenRoster</p>
            <p className="mx-0 mt-0.5 mb-0 text-muted-foreground text-[0.8125rem]">
              Password reset
            </p>
          </div>
        </div>
        <div className="max-w-136 [&>p:last-child]:text-muted-foreground [&>p:last-child]:leading-[1.65] [&_h1]:mx-0 [&_h1]:mt-2 [&_h1]:mb-3.5 [&_h1]:text-[length:clamp(2rem,4vw,3rem)] [&_h1]:font-semibold [&_h1]:tracking-[-0.02em] [&_h1]:leading-[1.1] [&_p]:m-0">
          <Kicker>One-time link</Kicker>
          <h1 id="reset-title">Choose a new password</h1>
          <p>
            Use a password of at least {MINIMUM_PASSWORD_LENGTH} characters.
          </p>
        </div>
        <ResetForm />
      </section>
    </main>
  );
}
