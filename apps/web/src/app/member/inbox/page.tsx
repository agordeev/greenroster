import { redirect } from "next/navigation";

import { resolveMemberPageSession } from "@/lib/auth/member-page-session";
import { signInPath } from "@/lib/auth/safe-return-path";
import { executeReadMemberInbox } from "@/lib/notifications/member-inbox-data";

import { MemberInboxList } from "./member-inbox-list";
import { Kicker, SkipLink, TextLink } from "@/components/blocks";

export default async function MemberInboxPage() {
  const access = await resolveMemberPageSession();
  if (access.state === "authentication_required") {
    redirect(signInPath("/member/inbox"));
  }
  if (access.state === "recovery_active") redirect("/reset-password");
  if (access.state === "role_redirect") redirect("/portal");
  if (access.state !== "ready") return <MemberInboxUnavailable />;

  let items;
  try {
    items = await executeReadMemberInbox(access.userId);
  } catch {
    return <MemberInboxUnavailable />;
  }

  return (
    <>
      <SkipLink />
      <main
        id="main-content"
        tabIndex={-1}
        className="p-8 min-h-screen grid grid-cols-[minmax(20rem,38rem)] place-content-center max-[800px]:grid-cols-[1fr] max-[480px]:p-0 [&_[data-slot=auth-ledger]]:border [&_[data-slot=auth-ledger]]:min-h-auto [&_[data-slot=auth-ledger]]:w-[min(100%,52rem)] max-[480px]:[&_[data-slot=auth-ledger]]:border-0! max-[480px]:[&_[data-slot=auth-ledger]]:w-full!"
      >
        <section
          className="p-[clamp(2rem,7vw,6rem)] border-r flex min-h-screen flex-col justify-center bg-card max-[800px]:border-r-0 max-[800px]:min-h-auto max-[480px]:p-6 [&>[data-slot=text-link]]:mt-5 [&>[data-slot=text-link]]:inline-block"
          data-slot="auth-ledger"
          aria-labelledby="member-inbox-title"
        >
          <nav
            className="mb-10 pb-4 border-b border-b-border/50 flex flex-wrap gap-y-3 gap-x-5"
            aria-label="Member navigation"
          >
            <TextLink href="/member/home">Home</TextLink>
            <TextLink href="/member/profile">Profile</TextLink>
          </nav>
          <div className="max-w-136 [&>p:last-child]:text-muted-foreground [&>p:last-child]:leading-[1.65] [&_h1]:mx-0 [&_h1]:mt-2 [&_h1]:mb-3.5 [&_h1]:text-[length:clamp(2rem,4vw,3rem)] [&_h1]:font-semibold [&_h1]:tracking-[-0.02em] [&_h1]:leading-[1.1] [&_p]:m-0">
            <Kicker>Your inbox</Kicker>
            <h1 id="member-inbox-title">Round updates</h1>
            <p className="text-muted-foreground leading-[1.65]">
              Updates from your coordinators and administrators appear here.
            </p>
            <MemberInboxList initialItems={items} />
          </div>
        </section>
      </main>
    </>
  );
}

function MemberInboxUnavailable() {
  return (
    <main className="p-8 min-h-screen grid grid-cols-[minmax(20rem,38rem)] place-content-center max-[800px]:grid-cols-[1fr] max-[480px]:p-0 [&_[data-slot=auth-ledger]]:border [&_[data-slot=auth-ledger]]:min-h-auto [&_[data-slot=auth-ledger]]:w-[min(100%,52rem)] max-[480px]:[&_[data-slot=auth-ledger]]:border-0! max-[480px]:[&_[data-slot=auth-ledger]]:w-full!">
      <section
        className="p-[clamp(2rem,7vw,6rem)] border-r flex min-h-screen flex-col justify-center bg-card max-[800px]:border-r-0 max-[800px]:min-h-auto max-[480px]:p-6 [&>[data-slot=text-link]]:mt-5 [&>[data-slot=text-link]]:inline-block"
        data-slot="auth-ledger"
        aria-labelledby="member-inbox-unavailable-title"
      >
        <Kicker>Your inbox</Kicker>
        <h1 id="member-inbox-unavailable-title">We couldn’t load your inbox</h1>
        <p>Refresh this page and try again.</p>
        <TextLink href="/member/home">Home</TextLink>
      </section>
    </main>
  );
}
