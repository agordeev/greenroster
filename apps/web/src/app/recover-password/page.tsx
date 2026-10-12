import { FormMessage, Kicker } from "@/components/blocks";

import { RecoveryForm } from "./recovery-form";

type RecoverPasswordPageProps = {
  searchParams: Promise<{ status?: string }>;
};

export default async function RecoverPasswordPage({
  searchParams,
}: RecoverPasswordPageProps) {
  const { status } = await searchParams;

  return (
    <main className="p-8 min-h-screen grid grid-cols-[minmax(20rem,38rem)] place-content-center max-[800px]:grid-cols-[1fr] max-[480px]:p-0 [&_[data-slot=auth-ledger]]:border [&_[data-slot=auth-ledger]]:min-h-auto max-[480px]:[&_[data-slot=auth-ledger]]:border-0!">
      <section
        className="p-[clamp(2rem,7vw,6rem)] border-r flex min-h-screen flex-col justify-center bg-card max-[800px]:border-r-0 max-[800px]:min-h-auto max-[480px]:p-6 [&>[data-slot=text-link]]:mt-5 [&>[data-slot=text-link]]:inline-block"
        data-slot="auth-ledger"
        aria-labelledby="recovery-title"
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
              Account recovery
            </p>
          </div>
        </div>
        <div className="max-w-136 [&>p:last-child]:text-muted-foreground [&>p:last-child]:leading-[1.65] [&_h1]:mx-0 [&_h1]:mt-2 [&_h1]:mb-3.5 [&_h1]:text-[length:clamp(2rem,4vw,3rem)] [&_h1]:font-semibold [&_h1]:tracking-[-0.02em] [&_h1]:leading-[1.1] [&_p]:m-0">
          <Kicker>Password help</Kicker>
          <h1 id="recovery-title">Reset your password</h1>
          <p>Enter your account e-mail and we’ll send you a recovery link.</p>
        </div>
        {status === "expired" ? (
          <FormMessage className="mt-6 max-w-[30rem]" role="alert">
            This recovery link has expired or was already used. Enter your
            e-mail below to get a new one.
          </FormMessage>
        ) : null}
        {status === "unavailable" ? (
          <FormMessage className="mt-6 max-w-[30rem]" role="alert">
            We could not open your recovery link just now. Open it again in a
            moment.
          </FormMessage>
        ) : null}
        <RecoveryForm />
      </section>
    </main>
  );
}
