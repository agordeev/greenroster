import { redirect } from "next/navigation";
import { z } from "zod";

import type { MemberNextRound } from "@/domain/member-next-round";
import { executeReadMemberNextRound } from "@/lib/rounds/member-next-round-data";
import {
  executeReadMemberOfficialResults,
  executeReadMemberQuotaHistory,
  executeReadMemberStandings,
  type MemberOfficialResult,
  type MemberQuotaHistory,
  type MemberStanding,
} from "@/lib/rounds/member-results-data";
import { resolveMemberPageSession } from "@/lib/auth/member-page-session";
import { signInPath } from "@/lib/auth/safe-return-path";
import { executeReadClubhouseContent } from "@/lib/clubhouse/clubhouse-content-data";
import type { ClubhouseProjection } from "@/domain/clubhouse-content";

import { MemberNextRoundRsvp } from "./member-next-round-rsvp";
import {
  MemberNotificationPreferences,
  type MemberNotificationPreference,
} from "./member-notification-preferences";
import {
  Kicker,
  SkipLink,
  standalonePageWideClass,
  standalonePanelClass,
  TextLink,
} from "@/components/blocks";
import { MemberNav } from "../member-nav";

const firstRunSchema = z
  .array(z.object({ is_complete: z.boolean() }))
  .length(1);

// The read also returns push and bookkeeping columns; only what the e-mail
// choices need is kept.
const preferenceRowsSchema = z.array(
  z.object({
    category: z.string().min(1),
    mandatory: z.boolean(),
    email_enabled: z.boolean(),
    email_allowed: z.boolean(),
    version: z.union([z.number().int().nonnegative(), z.string()]),
  }),
);

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

  let nextRound: MemberNextRound | null;
  try {
    nextRound = await executeReadMemberNextRound(access.userId);
  } catch {
    return <MemberHomeUnavailable />;
  }

  const [standingsResult, historyResult] = await Promise.allSettled([
    executeReadMemberStandings(access.userId),
    executeReadMemberQuotaHistory(access.userId),
  ]);
  const clubhouseResult = await executeReadClubhouseContent(
    access.userId,
  ).catch(() => null);
  const preferencesResult = await access.client.rpc(
    "resolve_mobile_member_notification_preferences",
  );
  const parsedPreferences = preferenceRowsSchema.safeParse(
    preferencesResult.data,
  );
  const preferences: readonly MemberNotificationPreference[] | null =
    preferencesResult.error || !parsedPreferences.success
      ? null
      : parsedPreferences.data.map((row) => ({
          ...row,
          version: Number(row.version),
        }));
  const standings =
    standingsResult.status === "fulfilled" ? standingsResult.value : null;
  const history =
    historyResult.status === "fulfilled" ? historyResult.value : null;
  const recentHistory = history?.[0] ?? null;
  let recentResult: Readonly<{
    results: readonly MemberOfficialResult[];
    history: MemberQuotaHistory;
  }> | null = null;
  if (recentHistory) {
    try {
      const official = await executeReadMemberOfficialResults(
        access.userId,
        recentHistory.round_id,
      );
      recentResult = { history: recentHistory, results: official.results };
    } catch {
      recentResult = null;
    }
  }

  return (
    <>
      <SkipLink />
      <main id="main-content" tabIndex={-1} className={standalonePageWideClass}>
        <section
          className={standalonePanelClass}
          data-slot="auth-ledger"
          aria-labelledby="member-home-title"
        >
          <MemberNav current="home" />
          <div className="max-w-168 [&>p:last-child]:text-muted-foreground [&>p:last-child]:leading-[1.65] [&_h1]:mx-0 [&_h1]:mt-2 [&_h1]:mb-3.5 [&_h1]:text-[length:clamp(2rem,4vw,3rem)] [&_h1]:font-semibold [&_h1]:tracking-[-0.02em] [&_h1]:leading-[1.1] [&_p]:m-0">
            <h1 id="member-home-title">
              {groupResult.data?.name ?? "Your GreenRoster group"}
            </h1>
            <p className="text-muted-foreground leading-[1.65]">
              Your next round, recent results, and where you stand.
            </p>
            {nextRound ? (
              <NextRoundCard round={nextRound} />
            ) : (
              <section
                className="mt-10 pt-8 border-t [&>p:not([data-slot=kicker])]:text-muted-foreground [&>p:not([data-slot=kicker])]:leading-[1.65] [&_h2]:mx-0 [&_h2]:mt-1.5 [&_h2]:mb-0 [&_h2]:text-[1.5rem] [&_h2]:font-semibold"
                aria-labelledby="next-round-title"
              >
                <Kicker>Next round</Kicker>
                <h2 id="next-round-title">Nothing published yet</h2>
                <p>
                  Your next round will appear here once your group publishes it
                  and opens RSVPs.
                </p>
              </section>
            )}
            <MemberHomeResultsSummary
              standings={standings}
              history={history}
              recentResult={recentResult}
            />
            <MemberClubhouseSummary projection={clubhouseResult} />
            <MemberNotificationPreferences preferences={preferences} />
            <TextLink href="/account">Change account e-mail</TextLink>
          </div>
        </section>
      </main>
    </>
  );
}

function MemberClubhouseSummary({
  projection,
}: Readonly<{ projection: ClubhouseProjection | null }>) {
  return (
    <section
      className="mt-10 pt-8 gap-4 border-t grid [&_[data-slot=member-stats-summary]]:mt-2! [&_h2]:mx-0 [&_h2]:mt-1.5 [&_h2]:mb-0 [&_h2]:font-semibold [&_h2]:text-[1.5rem] [&_h3]:mx-0 [&_h3]:mt-1.5 [&_h3]:mb-0 [&_h3]:font-semibold [&_h3]:text-[1.5rem]"
      aria-labelledby="clubhouse-title"
    >
      <div className="[&_h2]:mx-0 [&_h2]:mt-1.5 [&_h2]:mb-0 [&_h2]:text-[1.5rem] [&_h2]:font-semibold">
        <Kicker>Clubhouse</Kicker>
        <h2 id="clubhouse-title">News and videos</h2>
      </div>
      {!projection ? (
        <p className="text-muted-foreground leading-[1.55]">
          We could not load clubhouse news. Refresh the page to try again.
        </p>
      ) : projection.news.length === 0 && projection.media.length === 0 ? (
        <p className="text-muted-foreground leading-[1.55]">
          Your group has no clubhouse news yet.
        </p>
      ) : (
        <>
          {projection.news.slice(0, 3).map((item) => (
            <article
              className="p-5 gap-2 border grid rounded-lg [&_p:not([data-slot=kicker])]:m-0 [&_p:not([data-slot=kicker])]:text-muted-foreground [&_p:not([data-slot=kicker])]:leading-[1.55]!"
              key={item.id}
            >
              <h3>{item.title}</h3>
              <p>{item.body}</p>
              <p>{item.author}</p>
            </article>
          ))}
          {projection.media.slice(0, 3).map((item) => (
            <article
              className="p-5 gap-2 border grid rounded-lg [&_p:not([data-slot=kicker])]:m-0 [&_p:not([data-slot=kicker])]:text-muted-foreground [&_p:not([data-slot=kicker])]:leading-[1.55]!"
              key={item.id}
            >
              <h3>{item.title}</h3>
              <a
                className="justify-self-start text-primary text-[0.875rem] font-bold underline-offset-[0.2em] focus-visible:outline-[3px] focus-visible:outline-solid focus-visible:outline-ring focus-visible:outline-offset-[3px]"
                data-slot="text-link"
                href={item.mediaUrl}
                target="_blank"
                rel="noreferrer"
              >
                Open video
              </a>
            </article>
          ))}
        </>
      )}
    </section>
  );
}

function MemberHomeResultsSummary({
  standings,
  history,
  recentResult,
}: Readonly<{
  standings: readonly MemberStanding[] | null;
  history: readonly MemberQuotaHistory[] | null;
  recentResult: Readonly<{
    results: readonly MemberOfficialResult[];
    history: MemberQuotaHistory;
  }> | null;
}>) {
  const own = standings?.find((row) => row.is_actor) ?? null;
  const winnerRank = recentResult?.results.find(
    (result) => result.competition_rank !== null,
  )?.competition_rank;
  const winners = winnerRank
    ? (recentResult?.results.filter(
        (result) => result.competition_rank === winnerRank,
      ) ?? [])
    : [];

  return (
    <section
      className="mt-10 pt-8 gap-4 border-t grid [&_[data-slot=member-stats-summary]]:mt-2! [&_h2]:mx-0 [&_h2]:mt-1.5 [&_h2]:mb-0 [&_h2]:font-semibold [&_h2]:text-[1.5rem] [&_h3]:mx-0 [&_h3]:mt-1.5 [&_h3]:mb-0 [&_h3]:font-semibold [&_h3]:text-[1.5rem]"
      aria-labelledby="member-home-summary-title"
    >
      <div className="[&_h2]:mx-0 [&_h2]:mt-1.5 [&_h2]:mb-0 [&_h2]:text-[1.5rem] [&_h2]:font-semibold">
        <h2 id="member-home-summary-title">Your results and standings</h2>
      </div>
      {recentResult ? (
        <article className="p-5 gap-2 border grid rounded-lg [&_p:not([data-slot=kicker])]:m-0 [&_p:not([data-slot=kicker])]:text-muted-foreground [&_p:not([data-slot=kicker])]:leading-[1.55]!">
          <Kicker>Recent result</Kicker>
          <h3>{recentResult.history.round_description ?? "Completed round"}</h3>
          <p>
            {formatCompletedAt(
              recentResult.history.completed_at,
              recentResult.history.group_time_zone,
            )}{" "}
            ·{" "}
            {recentResult.history.format === "individual_net"
              ? "Individual Net"
              : "Individual Gross"}
          </p>
          {winners.length > 0 ? (
            <p>
              Winner{winners.length === 1 ? "" : "s"}:{" "}
              {winners.map(displayName).join(" and ")}
            </p>
          ) : null}
          <TextLink
            href={
              "/member/results?round_id=" +
              encodeURIComponent(recentResult.history.round_id)
            }
          >
            See full results
          </TextLink>
        </article>
      ) : history === null ? (
        <p className="text-muted-foreground leading-[1.55]" role="status">
          We could not load results and standings. Refresh the page to try
          again.
        </p>
      ) : (
        <p className="text-muted-foreground leading-[1.55]" role="status">
          No official results are available yet.
        </p>
      )}
      <dl
        className="mt-8 gap-3 grid grid-cols-4 max-[720px]:grid-cols-2 [&_div]:p-[0.9rem] [&_div]:gap-[0.35rem] [&_div]:border [&_div]:grid [&_div]:min-h-22 [&_div]:rounded-lg [&_dd]:m-0 [&_dd]:font-mono [&_dd]:text-[1.25rem] [&_div]:content-start [&_dd]:font-medium [&_dd]:tabular-nums [&_dt]:font-mono [&_dt]:text-[0.6875rem] [&_dt]:tracking-[0.08em] [&_dt]:text-muted-foreground [&_dt]:uppercase"
        data-slot="member-stats-summary"
        aria-label="Your standings summary"
      >
        <div>
          <dt>Current quota</dt>
          <dd>{own?.projected_quota ?? "Not available"}</dd>
        </div>
        <div>
          <dt>Merit total</dt>
          <dd>{own?.merit_total ?? "0"}</dd>
        </div>
        <div>
          <dt>Rounds played</dt>
          <dd>{own?.rounds_played ?? "0"}</dd>
        </div>
        <div>
          <dt>Order of Merit rank</dt>
          <dd>{own?.standing_rank ?? "Not ranked"}</dd>
        </div>
      </dl>
      <TextLink href="/member/standings">Open standings and history</TextLink>
    </section>
  );
}

function displayName(
  result: Pick<MemberOfficialResult, "first_name" | "last_name">,
) {
  return (
    [result.first_name, result.last_name]
      .filter((value): value is string => Boolean(value?.trim()))
      .join(" ")
      .trim() || "Unnamed player"
  );
}

function formatCompletedAt(value: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  }).format(new Date(value));
}

function NextRoundCard({ round }: Readonly<{ round: MemberNextRound }>) {
  return (
    <section
      className="mt-10 pt-8 border-t [&_[data-slot=invitation-summary]]:mb-0"
      aria-labelledby="next-round-title"
    >
      <div className="[&_h2]:mx-0 [&_h2]:mt-1.5 [&_h2]:mb-0 [&_h2]:text-[1.5rem] [&_h2]:font-semibold">
        <Kicker>Next round</Kicker>
        <h2 id="next-round-title">{round.description ?? "Golf round"}</h2>
      </div>
      <dl
        className="mx-0 mt-9 mb-0 pt-6 border-t grid grid-cols-2 gap-y-4 gap-x-6 max-[480px]:grid-cols-[1fr] [&_dd]:mx-0 [&_dd]:mt-[0.3rem] [&_dd]:mb-0 [&_dd]:text-foreground [&_dd]:wrap-anywhere [&_div]:min-w-0 [&_dt]:text-muted-foreground [&_dt]:font-mono [&_dt]:text-[0.6875rem] [&_dt]:tracking-[0.1em] [&_dt]:uppercase"
        data-slot="invitation-summary"
        aria-label="Next round details"
      >
        <div>
          <dt>When</dt>
          <dd>{formatGroupDateTime(round.scheduledAt, round.groupTimeZone)}</dd>
        </div>
        <div>
          <dt>Venue</dt>
          <dd>{round.venue ?? "Venue to be announced"}</dd>
        </div>
        <div>
          <dt>Format</dt>
          <dd>{formatRound(round.format)}</dd>
        </div>
        {round.rsvpDeadlineAt ? (
          <div>
            <dt>RSVP deadline</dt>
            <dd>
              {formatGroupDateTime(round.rsvpDeadlineAt, round.groupTimeZone)}
            </dd>
          </div>
        ) : null}
      </dl>
      {round.notes ? (
        <p className="mx-0 mt-6 mb-0 rounded-lg p-4 bg-muted text-muted-foreground leading-[1.55]">
          <strong>Notes for players:</strong> {round.notes}
        </p>
      ) : null}
      <div className="mt-6 pt-6 border-t border-t-border/50 [&>[data-slot=field-help]]:mx-0 [&>[data-slot=field-help]]:mb-0 [&>[data-slot=field-help]]:mt-0!">
        <MemberNextRoundRsvp
          key={`${round.roundId}:${round.participant.version}`}
          roundId={round.roundId}
          groupTimeZone={round.groupTimeZone}
          initialRsvpStatus={round.participant.rsvpStatus}
          initialParticipantVersion={round.participant.version}
          initialChangedAt={round.participant.changedAt}
        />
      </div>
      <TextLink href={`/member/rounds/${encodeURIComponent(round.roundId)}`}>
        Open this round
      </TextLink>
    </section>
  );
}

function formatRound(format: MemberNextRound["format"]): string {
  return format === "individual_net" ? "Individual Net" : "Individual Gross";
}

function formatGroupDateTime(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "full",
    timeStyle: "short",
    timeZone,
  }).format(new Date(value));
}

function MemberHomeUnavailable() {
  return (
    <>
      <SkipLink />
      <main id="main-content" tabIndex={-1} className={standalonePageWideClass}>
        <section className={standalonePanelClass} data-slot="auth-ledger">
          <Kicker>Home</Kicker>
          <h1>We could not load your home page</h1>
          <p>Try again in a moment or ask a group coordinator for help.</p>
        </section>
      </main>
    </>
  );
}
