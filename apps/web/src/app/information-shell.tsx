import Link from "next/link";
import type { ReactNode } from "react";

import { InformationFooter } from "@/app/information-footer";
import { BrandMark, Kicker, SkipLink, TextLink } from "@/components/blocks";

export function InformationShell({
  children,
  kicker,
  title,
}: Readonly<{ children: ReactNode; kicker: string; title: string }>) {
  return (
    <div className="p-[clamp(1.5rem,4vw,3rem)] flex min-h-screen flex-col max-[480px]:p-0 [&_[data-slot=information-footer]]:mt-auto [&_:is([data-slot=information-header],[data-slot=information-footer],main)]:w-full [&_:is([data-slot=information-header],[data-slot=information-footer])]:max-w-232">
      <SkipLink />
      <header
        className="mx-auto grid max-w-288 grid-cols-[1fr_auto] items-center gap-x-8 gap-y-3 px-1 max-[480px]:px-6 max-[480px]:pt-5"
        data-slot="information-header"
      >
        <Link
          className="gap-3 inline-flex items-center text-inherit no-underline [&>span:last-child]:gap-0.5 [&>span:last-child]:grid [&>span:last-child]:min-w-0 [&_small]:text-muted-foreground [&_small]:text-[0.75rem] [&_small]:wrap-anywhere [&_strong]:font-heading [&_strong]:text-[1.125rem] [&_strong]:leading-tight [&_strong]:font-semibold"
          href="/"
        >
          <BrandMark />
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
        className="mx-auto my-6 min-h-104 max-w-232 animate-in rounded-xl border-t-[3px] border-t-primary bg-card p-[clamp(1.5rem,6vw,5rem)] ring-1 ring-foreground/10 duration-500 fade-in slide-in-from-bottom-2 max-[480px]:mx-0 max-[480px]:mb-0 max-[480px]:rounded-none max-[480px]:ring-0 max-[480px]:min-h-[calc(100vh_-_12rem)] [&_h1]:mx-0 [&_h1]:mt-2.5 [&_h1]:mb-6 [&_h1]:text-[length:clamp(1.75rem,3vw,2.5rem)] [&_h1]:font-semibold [&_h1]:tracking-[-0.02em] [&_h1]:leading-[1.1]"
      >
        <Kicker>{kicker}</Kicker>
        <h1>{title}</h1>
        {children}
      </main>
      <InformationFooter />
    </div>
  );
}
