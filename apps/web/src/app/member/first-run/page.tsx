import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { z } from "zod";

import { resolveMemberPageSession } from "@/lib/auth/member-page-session";
import { signInPath } from "@/lib/auth/safe-return-path";

import { MemberFirstRunForm } from "./first-run-form";
import { Kicker } from "@/components/blocks";

const firstRunRowsSchema = z
  .array(
    z.object({
      first_name: z.string().nullable(),
      last_name: z.string().nullable(),
      current_terms_version: z.string().min(1),
      current_privacy_version: z.string().min(1),
      is_complete: z.boolean(),
    }),
  )
  .length(1);

export default async function MemberFirstRunPage() {
  const access = await resolveMemberPageSession();
  if (access.state === "authentication_required") {
    redirect(signInPath("/member/first-run"));
  }
  if (access.state === "recovery_active") redirect("/reset-password");
  if (access.state === "role_redirect") redirect("/portal");
  if (access.state !== "ready") return <FirstRunUnavailable />;

  const result = await access.client.rpc("resolve_mobile_first_run");
  const parsed = firstRunRowsSchema.safeParse(result.data);
  if (result.error || !parsed.success) {
    return <FirstRunUnavailable />;
  }

  const firstRun = parsed.data[0];
  if (firstRun.is_complete) redirect("/member/home");

  return (
    <main className="p-8 min-h-screen grid grid-cols-[minmax(20rem,38rem)] place-content-center max-[800px]:grid-cols-[1fr] max-[480px]:p-0 [&_[data-slot=auth-ledger]]:border [&_[data-slot=auth-ledger]]:min-h-auto [&_[data-slot=auth-ledger]]:w-[min(100%,52rem)] max-[480px]:[&_[data-slot=auth-ledger]]:border-0! max-[480px]:[&_[data-slot=auth-ledger]]:w-full!">
      <section
        className="p-[clamp(2rem,7vw,6rem)] border-r flex min-h-screen flex-col justify-center bg-card max-[800px]:border-r-0 max-[800px]:min-h-auto max-[480px]:p-6 [&>[data-slot=text-link]]:mt-5 [&>[data-slot=text-link]]:inline-block"
        data-slot="auth-ledger"
        aria-labelledby="first-run-title"
      >
        <div className="max-w-136 [&>p:last-child]:text-muted-foreground [&>p:last-child]:leading-[1.65] [&_h1]:mx-0 [&_h1]:mt-2 [&_h1]:mb-3.5 [&_h1]:text-[length:clamp(2rem,4vw,3rem)] [&_h1]:font-semibold [&_h1]:tracking-[-0.02em] [&_h1]:leading-[1.1] [&_p]:m-0">
          <Kicker>Welcome</Kicker>
          <h1 id="first-run-title">Confirm your profile</h1>
          <p>
            Check your name and read the current Terms and Privacy Policy before
            you continue.
          </p>
        </div>
        <MemberFirstRunForm
          firstName={firstRun.first_name ?? ""}
          lastName={firstRun.last_name ?? ""}
          operationId={randomUUID()}
          termsVersion={firstRun.current_terms_version}
          privacyVersion={firstRun.current_privacy_version}
        />
      </section>
    </main>
  );
}

function FirstRunUnavailable() {
  return (
    <main className="p-8 min-h-screen grid grid-cols-[minmax(20rem,38rem)] place-content-center max-[800px]:grid-cols-[1fr] max-[480px]:p-0 [&_[data-slot=auth-ledger]]:border [&_[data-slot=auth-ledger]]:min-h-auto [&_[data-slot=auth-ledger]]:w-[min(100%,52rem)] max-[480px]:[&_[data-slot=auth-ledger]]:border-0! max-[480px]:[&_[data-slot=auth-ledger]]:w-full!">
      <section
        className="p-[clamp(2rem,7vw,6rem)] border-r flex min-h-screen flex-col justify-center bg-card max-[800px]:border-r-0 max-[800px]:min-h-auto max-[480px]:p-6 [&>[data-slot=text-link]]:mt-5 [&>[data-slot=text-link]]:inline-block"
        data-slot="auth-ledger"
      >
        <Kicker>Welcome</Kicker>
        <h1>We could not load your profile</h1>
        <p>
          Try again in a moment or ask a group coordinator to review your
          membership.
        </p>
      </section>
    </main>
  );
}
