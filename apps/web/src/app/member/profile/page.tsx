import { redirect } from "next/navigation";

import { resolveMemberPageSession } from "@/lib/auth/member-page-session";
import { signInPath } from "@/lib/auth/safe-return-path";
import { executeReadMemberSelfProfile } from "@/lib/member/member-self-profile-data";

import { MemberSelfProfileForm } from "./member-self-profile-form";
import {
  Kicker,
  SkipLink,
  standalonePageWideClass,
  standalonePanelClass,
  TextLink,
} from "@/components/blocks";
import { MemberNav } from "../member-nav";

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
      <main id="main-content" tabIndex={-1} className={standalonePageWideClass}>
        <section
          className={standalonePanelClass}
          data-slot="auth-ledger"
          aria-labelledby="member-profile-title"
        >
          <MemberNav current="profile" />
          <div className="max-w-168 [&>p:last-child]:text-muted-foreground [&>p:last-child]:leading-[1.65] [&_h1]:mx-0 [&_h1]:mt-2 [&_h1]:mb-3.5 [&_h1]:text-[length:clamp(2rem,4vw,3rem)] [&_h1]:font-semibold [&_h1]:tracking-[-0.02em] [&_h1]:leading-[1.1] [&_p]:m-0">
            <Kicker>{profile.groupName}</Kicker>
            <h1 id="member-profile-title">Your profile</h1>
            <MemberSelfProfileForm initialProfile={profile} />
          </div>
        </section>
      </main>
    </>
  );
}

function MemberProfileUnavailable() {
  return (
    <main className={standalonePageWideClass}>
      <section
        className={standalonePanelClass}
        data-slot="auth-ledger"
        aria-labelledby="member-profile-error-title"
      >
        <Kicker>Your profile</Kicker>
        <h1 id="member-profile-error-title">We couldn’t load your profile</h1>
        <p>Refresh this page and try again.</p>
        <TextLink href="/member/home">Home</TextLink>
      </section>
    </main>
  );
}
