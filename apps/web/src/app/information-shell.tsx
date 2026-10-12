import Link from "next/link";
import type { ReactNode } from "react";

import { InformationFooter } from "@/app/information-footer";
import { Kicker, SkipLink, TextLink } from "@/components/blocks";

export function InformationShell({
  children,
  kicker,
  title,
}: Readonly<{ children: ReactNode; kicker: string; title: string }>) {
  return (
    <div className="p-[clamp(1.5rem,4vw,3rem)] min-h-screen bg-background max-[480px]:p-0 [&_:is([data-slot=information-header],[data-slot=information-footer])]:max-w-232">
      <SkipLink />
      <header
        className="mx-auto py-4 px-6 border grid items-center gap-y-3 gap-x-8 max-w-288 bg-card grid-cols-[1fr_auto] max-[480px]:border-x-0 max-[480px]:border-t-0 max-[480px]:border-b"
        data-slot="information-header"
      >
        <Link
          className="gap-3 inline-flex items-center text-inherit no-underline [&>span:last-child]:gap-0.5 [&>span:last-child]:grid [&>span:last-child]:min-w-0 [&_small]:text-muted-foreground [&_small]:text-[0.75rem] [&_small]:wrap-anywhere [&_strong]:text-[1rem] [&_strong]:tracking-[0.02em]"
          href="/"
        >
          <span
            className="border border-primary grid w-12 h-12 place-items-center rounded-full text-primary text-[0.875rem] font-bold tracking-[0.08em]"
            aria-hidden="true"
          >
            GR
          </span>
          <span>
            <strong>GreenRoster</strong>
            <small>Your group. Your rounds. One roster.</small>
          </span>
        </Link>
        <TextLink href="/sign-in">Sign in</TextLink>
      </header>
      <main
        id="main-content"
        tabIndex={-1}
        className="my-6 mx-auto p-[clamp(2rem,6vw,5rem)] border max-w-232 min-h-104 bg-card max-[480px]:m-0 max-[480px]:border-0 max-[480px]:min-h-[calc(100vh_-_12rem)] [&_h1]:mx-0 [&_h1]:mt-2.5 [&_h1]:mb-6 [&_h1]:text-[length:clamp(1.75rem,3vw,2.5rem)] [&_h1]:font-semibold [&_h1]:tracking-[-0.02em] [&_h1]:leading-[1.1]"
      >
        <Kicker>{kicker}</Kicker>
        <h1>{title}</h1>
        {children}
      </main>
      <InformationFooter />
    </div>
  );
}
