import { AuthPanel, FormMessage, Kicker } from "@/components/blocks";

import { RecoveryForm } from "./recovery-form";

type RecoverPasswordPageProps = {
  searchParams: Promise<{ status?: string }>;
};

export default async function RecoverPasswordPage({
  searchParams,
}: RecoverPasswordPageProps) {
  const { status } = await searchParams;

  return (
    <AuthPanel titleId="recovery-title">
      <div className="max-w-136 [&>p:last-child]:text-muted-foreground [&>p:last-child]:leading-[1.65] [&_h1]:mx-0 [&_h1]:mt-2 [&_h1]:mb-3.5 [&_h1]:text-[length:clamp(2rem,4vw,3rem)] [&_h1]:font-semibold [&_h1]:tracking-[-0.02em] [&_h1]:leading-[1.1] [&_p]:m-0">
        <Kicker>Password help</Kicker>
        <h1 id="recovery-title">Reset your password</h1>
        <p>Enter your account e-mail and we’ll send you a recovery link.</p>
      </div>
      {status === "expired" ? (
        <FormMessage className="mt-6 max-w-[30rem]" role="alert">
          This recovery link has expired or was already used. Enter your e-mail
          below to get a new one.
        </FormMessage>
      ) : null}
      {status === "unavailable" ? (
        <FormMessage className="mt-6 max-w-[30rem]" role="alert">
          We could not open your recovery link just now. Open it again in a
          moment.
        </FormMessage>
      ) : null}
      <RecoveryForm />
    </AuthPanel>
  );
}
