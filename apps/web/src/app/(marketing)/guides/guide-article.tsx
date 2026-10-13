import Link from "next/link";
import type { ReactNode } from "react";

import { PageHeader, Prose, SectionHeading } from "@/components/blocks";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

import { GuideLinks } from "./guide-links";
import { calculatorPath, guides, type GuidePath } from "./guides";

// The shape every guide shares, on the same grid as the calculator: the
// question as the title, the reading text in the main column, one "Start a
// group" step beside it (below it on phones), then the other guides.
export function GuideArticle({
  path,
  children,
}: Readonly<{ path: GuidePath; children: ReactNode }>) {
  const guide = guides.find((item) => item.path === path);

  return (
    <>
      <PageHeader kicker="Guide" title={guide?.question} />

      <div className="mt-8 grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <Card className="gap-0 border-t-[3px] border-t-primary p-[clamp(1.25rem,3vw,2rem)] text-base">
          <article>
            <Prose className="[&_h3]:mt-6 [&_h3]:mb-1 [&_h3]:text-foreground [&_li_a]:font-semibold [&_li_a]:text-primary [&_li_a]:underline [&_li_a]:decoration-primary/30 [&_li_a]:underline-offset-[0.3em] [&_li_a]:hover:decoration-primary [&_ol]:m-0 [&_ol]:mt-3 [&_ol]:list-none [&_ol]:border-b [&_ol]:p-0 [&_table]:my-4 [&>h2:first-child]:mt-0">
              {children}
            </Prose>
          </article>
        </Card>

        <Card className="gap-0 py-0 lg:sticky lg:top-6">
          <div className="grid gap-3 p-4">
            <h2 className="m-0 text-xl">Run your game on GreenRoster</h2>
            <p className="m-0 text-sm leading-[1.55] text-muted-foreground">
              Invite your members, record each round’s points, and see quotas
              and standings update when you complete the round.
            </p>
            <Button asChild className="w-full">
              <Link href="/sign-up">Start a group</Link>
            </Button>
          </div>
          <div className="grid gap-3 border-t p-4">
            <p className="m-0 text-sm leading-[1.55] text-muted-foreground">
              Have your points totals to hand? Work out your quota now.
            </p>
            <Button asChild variant="outline" className="w-full">
              <Link href={calculatorPath}>Open the quota calculator</Link>
            </Button>
          </div>
        </Card>
      </div>

      <section className="mt-12" aria-labelledby="more-guides-title">
        <SectionHeading
          kicker="Guides"
          title="Keep reading"
          titleId="more-guides-title"
        />
        <GuideLinks except={path} />
      </section>
    </>
  );
}

// A figure or a row of figures inside a sentence, set like the scorecard.
export function Figure({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <span className="font-mono font-medium text-foreground tabular-nums">
      {children}
    </span>
  );
}
