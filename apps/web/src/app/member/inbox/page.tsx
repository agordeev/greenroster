import { redirect } from "next/navigation";

import { resolveMemberPageSession } from "@/lib/auth/member-page-session";
import { signInPath } from "@/lib/auth/safe-return-path";
import { executeReadMemberInbox } from "@/lib/notifications/member-inbox-data";

import { MemberInboxList } from "./member-inbox-list";
import {
  Kicker,
  SkipLink,
  standalonePageWideClass,
  standalonePanelClass,
  TextLink,
} from "@/components/blocks";
import { MemberNav } from "../member-nav";

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
      <main id="main-content" tabIndex={-1} className={standalonePageWideClass}>
        <section
          className={standalonePanelClass}
          data-slot="auth-ledger"
          aria-labelledby="member-inbox-title"
        >
          <MemberNav current="inbox" />
          <div className="max-w-168 [&>p:last-child]:text-muted-foreground [&>p:last-child]:leading-[1.65] [&_h1]:mx-0 [&_h1]:mt-2 [&_h1]:mb-3.5 [&_h1]:text-[length:clamp(2rem,4vw,3rem)] [&_h1]:font-semibold [&_h1]:tracking-[-0.02em] [&_h1]:leading-[1.1] [&_p]:m-0">
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
    <main className={standalonePageWideClass}>
      <section
        className={standalonePanelClass}
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
