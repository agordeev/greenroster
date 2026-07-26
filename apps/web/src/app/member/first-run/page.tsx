import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { z } from "zod";

import { resolveMemberPageSession } from "@/lib/auth/member-page-session";
import { signInPath } from "@/lib/auth/safe-return-path";

import { MemberFirstRunForm } from "./first-run-form";

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
    <main className="auth-shell auth-shell-single invitation-shell">
      <section className="auth-ledger" aria-labelledby="first-run-title">
        <div className="auth-heading">
          <p className="ledger-kicker">Member first run</p>
          <h1 id="first-run-title">Confirm your profile</h1>
          <p>
            Confirm your name and review the current Terms and Privacy Policy
            before entering the member experience.
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
    <main className="auth-shell auth-shell-single invitation-shell">
      <section className="auth-ledger">
        <p className="ledger-kicker">Member first run</p>
        <h1>Your member profile could not be loaded</h1>
        <p>
          Try again in a moment or ask a group coordinator to review your
          membership.
        </p>
      </section>
    </main>
  );
}
