import { ArrowRightIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { Kicker } from "@/components/blocks";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { landingSignupSource } from "@/lib/auth/signup-source";

import { exampleRound, signed } from "./guides/example-round";
import { GuideLinks } from "./guides/guide-links";
import { calculatorPath } from "./guides/guides";

const signUpPath = `/sign-up?from=${landingSignupSource}`;

// Faint scorecard columns over a green field, as on the sign-in side panel.
const scorecardRules =
  "pointer-events-none absolute inset-0 bg-[repeating-linear-gradient(to_right,transparent_0,transparent_calc(100%/9-1px),rgb(255_255_255/0.07)_calc(100%/9-1px),rgb(255_255_255/0.07)_calc(100%/9))]";

const monoLabel =
  "font-mono text-[0.6875rem] font-medium tracking-[0.16em] uppercase";

// The page an organizer lands on at `/`: what GreenRoster does for their
// group, shown as the scorecard it keeps, then one way in.
export function LandingPage() {
  return (
    <>
      <Hero />
      <RoundSteps />
      <div className="mt-16 grid items-start gap-4 lg:grid-cols-2 max-[480px]:mt-12">
        <QuotaMethods />
        <MemberView />
      </div>
      <StartBand />
      <GuidesSection />
    </>
  );
}

function Hero() {
  return (
    <section
      aria-labelledby="landing-title"
      className="grid items-center gap-x-12 gap-y-10 pt-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,30rem)] lg:pt-10"
    >
      <div>
        <Kicker>For golf group organizers</Kicker>
        <h1
          id="landing-title"
          className="mt-4 mb-0 max-w-[14ch] text-[length:clamp(2.5rem,6vw,4.5rem)] leading-[1.02] font-semibold tracking-[-0.025em]"
        >
          Run your group’s quota game without the spreadsheet.
        </h1>
        <p className="mt-6 mb-0 max-w-136 text-[1.0625rem] leading-[1.65] text-foreground/85">
          You post the round and enter the points. You get the results in order,
          a new quota for every player, and the latest Order of Merit.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-3 max-[480px]:[&>a]:w-full">
          <Button asChild>
            <Link href={signUpPath}>Start a group</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href={calculatorPath}>Try the quota calculator</Link>
          </Button>
        </div>
        <p className="mt-5 mb-0 text-sm leading-[1.55] text-muted-foreground">
          Your members sign in to say whether they’re playing and to see their
          results and standings.
        </p>
      </div>
      <ResultsCard />
    </section>
  );
}

// One made-up round, the same one the guides use, set out the way GreenRoster
// shows a finished round: ranked by plus/minus, winner marked with the flag.
function ResultsCard() {
  const ranked = [...exampleRound]
    .map((row) => ({ ...row, plusMinus: row.points - row.quota }))
    .sort((a, b) => b.plusMinus - a.plusMinus);

  return (
    <figure className="relative m-0 animate-in overflow-hidden rounded-xl bg-primary p-[clamp(1.25rem,3vw,2rem)] text-primary-foreground delay-150 duration-700 fill-mode-both fade-in slide-in-from-bottom-3 max-[480px]:-mx-4 max-[480px]:rounded-none">
      <div
        className={`${scorecardRules} [mask-image:linear-gradient(to_bottom,black,transparent_70%)]`}
        aria-hidden="true"
      />
      <div className="relative flex items-center justify-between gap-4">
        <div className="h-1 w-12 bg-flag" aria-hidden="true" />
        <p className={`m-0 text-flag ${monoLabel}`}>Example round</p>
      </div>
      <p className="relative mt-6 mb-0 font-heading text-[1.5rem] leading-tight font-semibold">
        Results
      </p>
      <table className="relative mt-4 w-full border-collapse text-left text-[0.9375rem]">
        <caption className="sr-only">
          An example round: four players ranked by how far they beat their
          quota.
        </caption>
        <thead>
          <tr className="border-b border-primary-foreground/25 text-primary-foreground/70 [&>th]:pb-2 [&>th]:font-medium">
            <th scope="col" className={`w-8 ${monoLabel}`}>
              <span className="sr-only">Place</span>
            </th>
            <th scope="col" className={monoLabel}>
              Player
            </th>
            <th scope="col" className={`text-right ${monoLabel}`}>
              Quota
            </th>
            <th scope="col" className={`text-right ${monoLabel}`}>
              Points
            </th>
            <th scope="col" className={`text-right ${monoLabel}`}>
              +/−
            </th>
          </tr>
        </thead>
        <tbody>
          {ranked.map((row, index) => (
            <tr
              key={row.player}
              className="border-b border-primary-foreground/15 [&>td]:py-3"
            >
              <td
                className={`font-mono font-medium ${index === 0 ? "text-flag" : "text-primary-foreground/60"}`}
              >
                {index + 1}
              </td>
              <td className="font-semibold">
                {row.player}
                {index === 0 ? (
                  <span
                    className={`ml-2 inline-block rounded-sm bg-flag px-1.5 py-0.5 align-middle text-[0.625rem] text-flag-foreground ${monoLabel}`}
                  >
                    Winner
                  </span>
                ) : null}
              </td>
              <td className="text-right font-mono text-primary-foreground/75 tabular-nums">
                {row.quota}
              </td>
              <td className="text-right font-mono text-primary-foreground/75 tabular-nums">
                {row.points}
              </td>
              <td className="text-right font-mono text-[1.125rem] font-medium tabular-nums">
                {signed(row.plusMinus)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <figcaption className="relative mt-5 text-sm leading-[1.55] text-primary-foreground/80">
        Player D scored the fewest points and still won, by beating their quota
        by the most.
      </figcaption>
    </figure>
  );
}

const steps = [
  {
    title: "Post the round",
    body: "Set the date and start time and publish. Your members get an e-mail and tell you whether they’re playing.",
  },
  {
    title: "Enter the points",
    body: "After the round, enter each player’s points total. You see their plus/minus against their quota as you go.",
  },
  {
    title: "Complete the round",
    body: "Your members get their results by e-mail and a new quota for the next round, and the Order of Merit moves.",
  },
] as const;

// Three columns of one card, numbered like holes on a scorecard.
function RoundSteps() {
  return (
    <section aria-labelledby="steps-title" className="mt-20 max-[480px]:mt-14">
      <Kicker>Each round</Kicker>
      <h2
        id="steps-title"
        className="mt-3 mb-0 text-[length:clamp(1.75rem,3vw,2.25rem)] leading-[1.1] tracking-[-0.015em]"
      >
        Three jobs for you, and you never do the sums.
      </h2>
      <Card className="mt-8 gap-0 py-0">
        <ol className="m-0 grid list-none gap-px bg-border p-0 md:grid-cols-3">
          {steps.map((step, index) => (
            <li key={step.title} className="bg-card p-5">
              <p
                className={`m-0 text-muted-foreground ${monoLabel}`}
                aria-hidden="true"
              >
                Hole
              </p>
              <p
                className="mt-1 mb-0 font-mono text-[2.5rem] leading-none font-medium tabular-nums"
                aria-hidden="true"
              >
                {index + 1}
              </p>
              <h3 className="mt-5 mb-0">{step.title}</h3>
              <p className="mt-2 mb-0 text-sm leading-[1.6] text-foreground/80">
                {step.body}
              </p>
            </li>
          ))}
        </ol>
      </Card>
    </section>
  );
}

const quotaMethods = [
  {
    name: "Moving average",
    body: "The average of a player’s last 4 to 20 rounds. You choose how many.",
  },
  {
    name: "Best 10 of 20",
    body: "The average of their best 10 rounds out of their last 20.",
  },
  {
    name: "Previous plus/minus",
    body: "Last round’s quota, moved up or down by how far they beat or missed it.",
  },
] as const;

function QuotaMethods() {
  return (
    <PanelSection
      titleId="quota-title"
      kicker="Quotas"
      title="Keep quotas the way your group already does"
    >
      <p className="mt-3 mb-0 text-sm leading-[1.6] text-foreground/80">
        Pick your method once. A change counts from the next round you publish,
        so finished rounds stay as they were.
      </p>
      <dl className="mt-5 mb-0 border-b">
        {quotaMethods.map((method) => (
          <div key={method.name} className="border-t py-3">
            <dt className="font-semibold">{method.name}</dt>
            <dd className="mt-0.5 ml-0 text-sm leading-[1.55] text-muted-foreground">
              {method.body}
            </dd>
          </div>
        ))}
      </dl>
      <ArrowLink href={calculatorPath}>
        See what a player’s quota comes to
      </ArrowLink>
    </PanelSection>
  );
}

const memberStats = [
  { label: "Quota", value: "24" },
  { label: "Order of Merit", value: "3rd" },
  { label: "Rounds", value: "12" },
] as const;

function MemberView() {
  return (
    <PanelSection
      titleId="members-title"
      kicker="Your members"
      title="Every member sees where they stand"
    >
      <p className="mt-3 mb-0 text-sm leading-[1.6] text-foreground/80">
        Invite them by e-mail or bring your list in from a spreadsheet. Once
        they sign in, each member sees their next round, their results, and
        their place in the standings.
      </p>
      <figure className="m-0 mt-5">
        <dl className="m-0 grid grid-cols-3 gap-px overflow-hidden rounded-lg border bg-border">
          {memberStats.map((stat) => (
            <div key={stat.label} className="bg-card p-4">
              <dt className="text-xs text-muted-foreground">{stat.label}</dt>
              <dd className="mt-2 ml-0 font-mono text-3xl leading-none font-medium tabular-nums">
                {stat.value}
              </dd>
            </div>
          ))}
        </dl>
        <figcaption className="mt-2 font-mono text-[0.6875rem] text-muted-foreground">
          Example: one member’s standings
        </figcaption>
      </figure>
      <ul className="mt-5 mb-0 list-none border-b p-0 text-sm leading-[1.55] text-foreground/85 [&>li]:border-t [&>li]:py-2.5">
        <li>Say whether they’re playing in the next round</li>
        <li>See their points and plus/minus from every round</li>
        <li>Follow their quota and the Order of Merit</li>
      </ul>
    </PanelSection>
  );
}

function PanelSection({
  titleId,
  kicker,
  title,
  children,
}: Readonly<{
  titleId: string;
  kicker: string;
  title: string;
  children: ReactNode;
}>) {
  return (
    <section
      aria-labelledby={titleId}
      className="h-full rounded-xl border-t-[3px] border-t-primary bg-card p-[clamp(1.25rem,3vw,2rem)] ring-1 ring-foreground/10"
    >
      <Kicker>{kicker}</Kicker>
      <h2 id={titleId} className="mt-3 mb-0 text-[1.625rem] leading-[1.15]">
        {title}
      </h2>
      {children}
    </section>
  );
}

function ArrowLink({
  href,
  children,
}: Readonly<{ href: string; children: ReactNode }>) {
  return (
    <Link
      href={href}
      className="group mt-5 inline-flex min-h-11 items-center gap-2 rounded-sm text-sm font-semibold text-primary no-underline outline-none focus-visible:ring-3 focus-visible:ring-ring"
    >
      {children}
      <ArrowRightIcon
        className="size-4 transition-transform group-hover:translate-x-0.5"
        aria-hidden="true"
      />
    </Link>
  );
}

// The closing green field: one step to take.
function StartBand() {
  return (
    <section aria-labelledby="start-title" className="mt-20 max-[480px]:mt-14">
      <div className="relative overflow-hidden rounded-xl bg-primary p-[clamp(1.5rem,5vw,3.5rem)] text-primary-foreground max-[480px]:-mx-4 max-[480px]:rounded-none">
        <div
          className={`${scorecardRules} [mask-image:linear-gradient(to_left,black,transparent_60%)]`}
          aria-hidden="true"
        />
        <div className="relative h-1 w-12 bg-flag" aria-hidden="true" />
        <h2
          id="start-title"
          className="relative mt-8 mb-0 max-w-[18ch] text-[length:clamp(2rem,4vw,3rem)] leading-[1.05] tracking-[-0.02em]"
        >
          Set up your group before the next round.
        </h2>
        <p className="relative mt-4 mb-0 max-w-136 leading-[1.65] text-primary-foreground/85">
          Name your group, choose how quotas work, invite your members, and
          publish your first round.
        </p>
        <Button
          asChild
          variant="outline"
          className="relative mt-8 border-transparent text-foreground max-[480px]:w-full"
        >
          <Link href={signUpPath}>Start a group</Link>
        </Button>
      </div>
    </section>
  );
}

// For organizers not ready to start yet.
function GuidesSection() {
  return (
    <section aria-labelledby="guides-title" className="mt-12">
      <Kicker>Guides</Kicker>
      <h2 id="guides-title" className="mt-3 mb-0 text-2xl">
        New to quota games?
      </h2>
      <GuideLinks />
    </section>
  );
}
