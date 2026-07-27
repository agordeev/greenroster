import { redirect } from "next/navigation";
import Link from "next/link";
import { z } from "zod";

import { resolveMemberPageSession } from "@/lib/auth/member-page-session";
import { signInPath } from "@/lib/auth/safe-return-path";

const firstRunSchema = z
  .array(z.object({ is_complete: z.boolean() }))
  .length(1);

export default async function MemberHomePage() {
  const access = await resolveMemberPageSession();
  if (access.state === "authentication_required") {
    redirect(signInPath("/member/home"));
  }
  if (access.state === "recovery_active") redirect("/reset-password");
  if (access.state === "role_redirect") redirect("/portal");
  if (access.state !== "ready") return <MemberHomeUnavailable />;

  const firstRunResult = await access.client.rpc("resolve_mobile_first_run");
  const firstRun = firstRunSchema.safeParse(firstRunResult.data);
  if (firstRunResult.error || !firstRun.success) {
    return <MemberHomeUnavailable />;
  }
  if (!firstRun.data[0].is_complete) redirect("/member/first-run");

  const groupResult = await access.client
    .from("groups")
    .select("name")
    .eq("id", access.groupId)
    .single();

  return (
    <main className="auth-shell auth-shell-single invitation-shell">
      <section className="auth-ledger" aria-labelledby="member-home-title">
        <div className="auth-heading">
          <p className="ledger-kicker">Member home</p>
          <h1 id="member-home-title">
            {groupResult.data?.name ?? "Your GreenRoster group"}
          </h1>
          <p>
            Your membership is active and your profile is complete. You can
            return here whenever you sign in to GreenRoster.
          </p>
          <Link className="secondary-link" href="/account">
            Manage account e-mail
          </Link>
        </div>
      </section>
    </main>
  );
}

function MemberHomeUnavailable() {
  return (
    <main className="auth-shell auth-shell-single invitation-shell">
      <section className="auth-ledger">
        <p className="ledger-kicker">Member home</p>
        <h1>Your membership could not be loaded</h1>
        <p>Try again in a moment or ask a group coordinator for help.</p>
      </section>
    </main>
  );
}
