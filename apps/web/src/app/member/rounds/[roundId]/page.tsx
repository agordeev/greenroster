import Link from "next/link";
import { redirect } from "next/navigation";
import { z } from "zod";

import { MemberNextRoundRsvp } from "@/app/member/home/member-next-round-rsvp";
import type { MemberRoundDetail } from "@/domain/member-round-detail";
import { resolveMemberPageSession } from "@/lib/auth/member-page-session";
import { signInPath } from "@/lib/auth/safe-return-path";
import { executeReadLiveRoundScores } from "@/lib/rounds/live-round-score-data";
import {
  executeReadMemberRoundDetail,
  executeReadMemberRoundGuestContext,
} from "@/lib/rounds/member-round-detail-data";

import { MemberLiveRoundScorePanel } from "./member-live-round-score-panel";
import { MemberRoundGuestPanel } from "./member-round-guest-panel";

const roundIdSchema = z.uuid();

export default async function MemberRoundPage({
  params,
}: Readonly<{ params: Promise<{ roundId: string }> }>) {
  const { roundId: rawRoundId } = await params;
  const parsedRoundId = roundIdSchema.safeParse(rawRoundId);
  if (!parsedRoundId.success) return <MemberRoundUnavailable />;

  const access = await resolveMemberPageSession();
  if (access.state === "authentication_required") {
    redirect(signInPath(`/member/rounds/${parsedRoundId.data}`));
  }
  if (access.state === "recovery_active") redirect("/reset-password");
  if (access.state === "role_redirect") redirect("/portal");
  if (access.state !== "ready") return <MemberRoundUnavailable />;

  let detail: MemberRoundDetail;
  try {
    detail = await executeReadMemberRoundDetail(
      access.client,
      parsedRoundId.data,
    );
  } catch {
    return <MemberRoundUnavailable />;
  }
  if (detail.state === "completed") {
    redirect(`/member/results?round_id=${encodeURIComponent(detail.roundId)}`);
  }

  const [guestContextResult, liveScoresResult] = await Promise.allSettled([
    executeReadMemberRoundGuestContext(access.userId, detail.roundId),
    detail.state === "live"
      ? executeReadLiveRoundScores(access.userId, detail.roundId)
      : Promise.resolve([] as const),
  ]);
  const guestContext =
    guestContextResult.status === "fulfilled" ? guestContextResult.value : null;
  const liveScores =
    liveScoresResult.status === "fulfilled" ? liveScoresResult.value : null;

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
        <section className="auth-ledger" aria-labelledby="member-round-title">
          <nav className="member-results-nav" aria-label="Member navigation">
            <Link className="secondary-link" href="/member/home">
              Open your home
            </Link>
            <Link className="secondary-link" href="/member/standings">
              Open standings and history
            </Link>
            <Link className="secondary-link" href="/member/profile">
              Open your profile
            </Link>
          </nav>
          <p className="ledger-kicker">Your round</p>
          <h1 id="member-round-title">{detail.description ?? "Golf round"}</h1>
          <p className="member-home-intro">
            {formatState(detail.state)} · {formatRound(detail.format)}
          </p>
          <dl className="invitation-summary" aria-label="Round details">
            <div>
              <dt>When</dt>
              <dd>
                {formatDateTime(detail.scheduledAt, detail.groupTimeZone)}
              </dd>
            </div>
            <div>
              <dt>Venue</dt>
              <dd>{detail.venue ?? "Venue to be announced"}</dd>
            </div>
            <div>
              <dt>Players</dt>
              <dd>
                {detail.playingCount} Playing of {detail.participantCount}
              </dd>
            </div>
            {detail.rsvpDeadlineAt ? (
              <div>
                <dt>Response deadline</dt>
                <dd>
                  {formatDateTime(detail.rsvpDeadlineAt, detail.groupTimeZone)}
                </dd>
              </div>
            ) : null}
          </dl>
          {detail.notes ? (
            <p className="member-home-round-notes">
              <strong>Notes for players:</strong> {detail.notes}
            </p>
          ) : null}
          {detail.roundUrl ? (
            <p>
              <a className="secondary-link" href={detail.roundUrl}>
                Open round link
              </a>
            </p>
          ) : null}
          {detail.participantVersion !== null ? (
            <section
              className="member-read-section"
              aria-labelledby="your-response-title"
            >
              <p className="ledger-kicker">Your response</p>
              <h2 id="your-response-title">Playing status</h2>
              {detail.state === "published" ? (
                <MemberNextRoundRsvp
                  roundId={detail.roundId}
                  groupTimeZone={detail.groupTimeZone}
                  initialRsvpStatus={detail.participantStatus}
                  initialParticipantVersion={detail.participantVersion}
                  initialChangedAt={detail.rsvpChangedAt}
                />
              ) : (
                <p className="field-help">
                  You are {formatParticipantStatus(detail.participantStatus)}.
                  You cannot change your response after scoring opens.
                </p>
              )}
            </section>
          ) : null}

          {detail.state === "live" ? (
            liveScores ? (
              <MemberLiveRoundScorePanel participants={liveScores} />
            ) : (
              <p className="member-read-empty" role="status">
                You refresh this page to see your live score.
              </p>
            )
          ) : null}

          {guestContext ? (
            <MemberRoundGuestPanel context={guestContext} />
          ) : (
            <p className="member-read-empty" role="status">
              You refresh this page to see your guests.
            </p>
          )}
        </section>
      </main>
    </>
  );
}

function formatRound(format: MemberRoundDetail["format"]): string {
  return format === "individual_net" ? "Individual Net" : "Individual Gross";
}

function formatState(state: MemberRoundDetail["state"]): string {
  if (state === "live") return "You can enter scores now";
  if (state === "cancelled") {
    return "You cannot respond because this round is cancelled";
  }
  return "You can update your response";
}

function formatParticipantStatus(
  status: MemberRoundDetail["participantStatus"],
): string {
  if (status === "playing") return "playing";
  if (status === "not_playing") return "not playing";
  return "waiting to respond";
}

function formatDateTime(value: string | null, timeZone: string): string {
  if (!value) return "Time to be announced";
  return `${new Intl.DateTimeFormat("en-US", {
    dateStyle: "full",
    timeStyle: "short",
    timeZone,
  }).format(new Date(value))} (${timeZone})`;
}

function MemberRoundUnavailable() {
  return (
    <main className="auth-shell auth-shell-single invitation-shell">
      <section
        className="auth-ledger"
        aria-labelledby="member-round-error-title"
      >
        <p className="ledger-kicker">Your round</p>
        <h1 id="member-round-error-title">
          You cannot open this round right now
        </h1>
        <p>You return to your home and try again.</p>
        <Link className="secondary-link" href="/member/home">
          Open your home
        </Link>
      </section>
    </main>
  );
}
