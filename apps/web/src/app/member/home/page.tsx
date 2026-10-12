import { redirect } from "next/navigation";
import Link from "next/link";
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

const firstRunSchema = z
  .array(z.object({ is_complete: z.boolean() }))
  .length(1);

const preferenceRowsSchema = z.array(
  z
    .object({
      category: z.string().min(1),
      mandatory: z.boolean(),
      email_enabled: z.boolean(),
      push_enabled: z.boolean(),
      email_allowed: z.boolean(),
      push_allowed: z.boolean(),
    })
    .strict(),
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
      : parsedPreferences.data;
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
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <main
        id="main-content"
        tabIndex={-1}
        className="auth-shell auth-shell-single invitation-shell"
      >
        <section className="auth-ledger" aria-labelledby="member-home-title">
          <nav className="member-results-nav" aria-label="Member navigation">
            <Link className="secondary-link" href="/member/standings">
              Standings and history
            </Link>
            <Link className="secondary-link" href="#notifications">
              Notification preferences
            </Link>
            <Link className="secondary-link" href="/member/inbox">
              Open your inbox
            </Link>
            <Link className="secondary-link" href="/member/profile">
              Open your profile
            </Link>
            <Link className="secondary-link" href="/member/directory">
              Open your directory
            </Link>
          </nav>
          <div className="auth-heading">
            <p className="ledger-kicker">Member home</p>
            <h1 id="member-home-title">
              {groupResult.data?.name ?? "Your GreenRoster group"}
            </h1>
            <p className="member-home-intro">
              Your membership is active and your profile is complete. You can
              return here whenever you sign in to GreenRoster.
            </p>
            {nextRound ? (
              <NextRoundCard round={nextRound} />
            ) : (
              <section
                className="member-home-empty"
                aria-labelledby="next-round-title"
              >
                <p className="ledger-kicker">Next round</p>
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
            <Link className="secondary-link" href="/account">
              Manage account e-mail
            </Link>
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
      className="member-home-results-summary"
      aria-labelledby="clubhouse-title"
    >
      <div className="member-home-round-heading">
        <p className="ledger-kicker">Clubhouse</p>
        <h2 id="clubhouse-title">News and videos for you</h2>
      </div>
      {!projection ? (
        <p className="member-read-empty">
          We could not load clubhouse news. Refresh the page to try again.
        </p>
      ) : projection.news.length === 0 && projection.media.length === 0 ? (
        <p className="member-read-empty">
          Your group has no clubhouse news yet.
        </p>
      ) : (
        <>
          {projection.news.slice(0, 3).map((item) => (
            <article className="member-home-recent-result" key={item.id}>
              <h3>{item.title}</h3>
              <p>{item.body}</p>
              <p>{item.author}</p>
            </article>
          ))}
          {projection.media.slice(0, 3).map((item) => (
            <article className="member-home-recent-result" key={item.id}>
              <h3>{item.title}</h3>
              <a
                className="secondary-link"
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
      className="member-home-results-summary"
      aria-labelledby="member-home-summary-title"
    >
      <div className="member-home-round-heading">
        <p className="ledger-kicker">Results and standings</p>
        <h2 id="member-home-summary-title">Your results and standings</h2>
      </div>
      {recentResult ? (
        <article className="member-home-recent-result">
          <p className="ledger-kicker">Recent result</p>
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
              {winners.map(displayName).join(" and ")} at rank {winnerRank}
            </p>
          ) : null}
          <Link
            className="secondary-link"
            href={
              "/member/results?round_id=" +
              encodeURIComponent(recentResult.history.round_id)
            }
          >
            Open official result
          </Link>
        </article>
      ) : history === null ? (
        <p className="member-read-empty" role="status">
          We could not load results and standings. Refresh the page to try
          again.
        </p>
      ) : (
        <p className="member-read-empty" role="status">
          No official results are available yet.
        </p>
      )}
      <dl className="member-stats-summary" aria-label="Your standings summary">
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
      <Link className="secondary-link" href="/member/standings">
        Open standings and history
      </Link>
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
    <section className="member-home-round" aria-labelledby="next-round-title">
      <div className="member-home-round-heading">
        <p className="ledger-kicker">Next published round</p>
        <h2 id="next-round-title">{round.description ?? "Golf round"}</h2>
      </div>
      <dl className="invitation-summary" aria-label="Next round details">
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
        <p className="member-home-round-notes">
          <strong>Notes for players:</strong> {round.notes}
        </p>
      ) : null}
      <div className="member-home-rsvp">
        <MemberNextRoundRsvp
          key={`${round.roundId}:${round.participant.version}`}
          roundId={round.roundId}
          groupTimeZone={round.groupTimeZone}
          initialRsvpStatus={round.participant.rsvpStatus}
          initialParticipantVersion={round.participant.version}
          initialChangedAt={round.participant.changedAt}
        />
      </div>
      <Link
        className="secondary-link"
        href={`/member/rounds/${encodeURIComponent(round.roundId)}`}
      >
        Open this round
      </Link>
    </section>
  );
}

function formatRound(format: MemberNextRound["format"]): string {
  return format === "individual_net" ? "Individual Net" : "Individual Gross";
}

function formatGroupDateTime(value: string, timeZone: string): string {
  return `${new Intl.DateTimeFormat("en-US", {
    dateStyle: "full",
    timeStyle: "short",
    timeZone,
  }).format(new Date(value))} (${timeZone})`;
}

function MemberHomeUnavailable() {
  return (
    <>
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <main
        id="main-content"
        tabIndex={-1}
        className="auth-shell auth-shell-single invitation-shell"
      >
        <section className="auth-ledger">
          <p className="ledger-kicker">Member home</p>
          <h1>We could not load your home page</h1>
          <p>Try again in a moment or ask a group coordinator for help.</p>
        </section>
      </main>
    </>
  );
}
