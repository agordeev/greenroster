import { redirect } from "next/navigation";
import Link from "next/link";

import { resolveMemberPageSession } from "@/lib/auth/member-page-session";
import { signInPath } from "@/lib/auth/safe-return-path";
import { executeReadMemberSelfProfile } from "@/lib/member/member-self-profile-data";

import { MemberSelfProfileForm } from "./member-self-profile-form";
import { SkipLink } from "@/components/blocks";

export default async function MemberProfilePage() {
  const access = await resolveMemberPageSession();
  if (access.state === "authentication_required") {
    redirect(signInPath("/member/profile"));
  }
  if (access.state === "recovery_active") redirect("/reset-password");
  if (access.state === "role_redirect") redirect("/portal");
  if (access.state !== "ready") return <MemberProfileUnavailable />;

  let profile;
  try {
    profile = await executeReadMemberSelfProfile(access.client);
  } catch {
    return <MemberProfileUnavailable />;
  }

  return (
    <>
      <SkipLink />
      <main
        id="main-content"
        tabIndex={-1}
        className="auth-shell auth-shell-single invitation-shell"
      >
        <section className="auth-ledger" aria-labelledby="member-profile-title">
          <nav className="member-results-nav" aria-label="Member navigation">
            <Link className="secondary-link" href="/member/home">
              Home
            </Link>
            <Link className="secondary-link" href="/member/directory">
              Directory
            </Link>
          </nav>
          <div className="auth-heading">
            <p className="ledger-kicker">Your profile</p>
            <h1 id="member-profile-title">{profile.groupName}</h1>
            <MemberSelfProfileForm initialProfile={profile} />
          </div>
        </section>
      </main>
    </>
  );
}

function MemberProfileUnavailable() {
  return (
    <main className="auth-shell auth-shell-single invitation-shell">
      <section
        className="auth-ledger"
        aria-labelledby="member-profile-error-title"
      >
        <p className="ledger-kicker">Your profile</p>
        <h1 id="member-profile-error-title">We couldn’t load your profile</h1>
        <p>Refresh this page and try again.</p>
        <Link className="secondary-link" href="/member/home">
          Home
        </Link>
      </section>
    </main>
  );
}
