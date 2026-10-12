import { redirect } from "next/navigation";
import { z } from "zod";

import { MemberNextRoundRsvp } from "@/app/member/home/member-next-round-rsvp";
import type { MemberRoundDetail } from "@/domain/member-round-detail";
import { resolveMemberPageSession } from "@/lib/auth/member-page-session";
import { signInPath } from "@/lib/auth/safe-return-path";
import { executeReadMemberRoundDetail } from "@/lib/rounds/member-round-detail-data";
import { FieldHelp, Kicker, SkipLink, TextLink } from "@/components/blocks";

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
          aria-labelledby="member-round-title"
        >
          <nav
            className="mb-10 pb-4 border-b border-b-border/50 flex flex-wrap gap-y-3 gap-x-5"
            aria-label="Member navigation"
          >
            <TextLink href="/member/home">Home</TextLink>
            <TextLink href="/member/standings">
              Open standings and history
            </TextLink>
            <TextLink href="/member/profile">Profile</TextLink>
          </nav>
          <Kicker>Your round</Kicker>
          <h1 id="member-round-title">{detail.description ?? "Golf round"}</h1>
          <p className="text-muted-foreground leading-[1.65]">
            {formatState(detail.state)} · {formatRound(detail.format)}
          </p>
          <dl
            className="mx-0 mt-9 mb-0 pt-6 border-t grid grid-cols-2 gap-y-4 gap-x-6 max-[480px]:grid-cols-[1fr] [&_dd]:mx-0 [&_dd]:mt-[0.3rem] [&_dd]:mb-0 [&_dd]:text-foreground [&_dd]:wrap-anywhere [&_div]:min-w-0 [&_dt]:text-muted-foreground [&_dt]:text-[0.6875rem] [&_dt]:tracking-[0.1em] [&_dt]:uppercase"
            data-slot="invitation-summary"
            aria-label="Round details"
          >
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
                {detail.playingCount} of {detail.participantCount} playing
              </dd>
            </div>
            {detail.rsvpDeadlineAt ? (
              <div>
                <dt>RSVP deadline</dt>
                <dd>
                  {formatDateTime(detail.rsvpDeadlineAt, detail.groupTimeZone)}
                </dd>
              </div>
            ) : null}
          </dl>
          {detail.notes ? (
            <p className="mx-0 mt-6 mb-0 p-4 bg-muted text-muted-foreground leading-[1.55]">
              <strong>Notes for players:</strong> {detail.notes}
            </p>
          ) : null}
          {detail.roundUrl ? (
            <p>
              <a
                className="justify-self-start text-primary text-[0.875rem] font-bold underline-offset-[0.2em] focus-visible:outline-[3px] focus-visible:outline-solid focus-visible:outline-ring focus-visible:outline-offset-[3px]"
                data-slot="text-link"
                href={detail.roundUrl}
              >
                Open round link
              </a>
            </p>
          ) : null}
          {detail.participantVersion !== null ? (
            <section
              className="mt-10 pt-8 border-t [&>h2]:mx-0 [&>h2]:text-[1.5rem] [&>h2]:font-semibold [&>h2]:mt-1.5! [&>h2]:mb-0!"
              aria-labelledby="your-response-title"
            >
              <Kicker>Your response</Kicker>
              <h2 id="your-response-title">Are you playing?</h2>
              {detail.state === "published" ? (
                <MemberNextRoundRsvp
                  roundId={detail.roundId}
                  groupTimeZone={detail.groupTimeZone}
                  initialRsvpStatus={detail.participantStatus}
                  initialParticipantVersion={detail.participantVersion}
                  initialChangedAt={detail.rsvpChangedAt}
                />
              ) : (
                <FieldHelp>
                  You are {formatParticipantStatus(detail.participantStatus)}.
                  You can&apos;t change your answer once scoring has opened.
                </FieldHelp>
              )}
            </section>
          ) : null}

          {detail.state === "live" ? (
            <section
              className="mt-10 pt-8 border-t [&>h2]:mx-0 [&>h2]:text-[1.5rem] [&>h2]:font-semibold [&>h2]:mt-1.5! [&>h2]:mb-0!"
              aria-labelledby="round-day-access-title"
            >
              <Kicker>Round day</Kicker>
              <h2 id="round-day-access-title">Your round is live</h2>
              <FieldHelp>
                Open the GreenRoster app to enter scores and manage guests.
              </FieldHelp>
            </section>
          ) : null}
        </section>
      </main>
    </>
  );
}

function formatRound(format: MemberRoundDetail["format"]): string {
  return format === "individual_net" ? "Individual Net" : "Individual Gross";
}

function formatState(state: MemberRoundDetail["state"]): string {
  if (state === "live") return "Your round is live";
  if (state === "cancelled") {
    return "This round is cancelled, so you can't respond";
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
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "full",
    timeStyle: "short",
    timeZone,
  }).format(new Date(value));
}

function MemberRoundUnavailable() {
  return (
    <main className="p-8 min-h-screen grid grid-cols-[minmax(20rem,38rem)] place-content-center max-[800px]:grid-cols-[1fr] max-[480px]:p-0 [&_[data-slot=auth-ledger]]:border [&_[data-slot=auth-ledger]]:min-h-auto [&_[data-slot=auth-ledger]]:w-[min(100%,52rem)] max-[480px]:[&_[data-slot=auth-ledger]]:border-0! max-[480px]:[&_[data-slot=auth-ledger]]:w-full!">
      <section
        className="p-[clamp(2rem,7vw,6rem)] border-r flex min-h-screen flex-col justify-center bg-card max-[800px]:border-r-0 max-[800px]:min-h-auto max-[480px]:p-6 [&>[data-slot=text-link]]:mt-5 [&>[data-slot=text-link]]:inline-block"
        data-slot="auth-ledger"
        aria-labelledby="member-round-error-title"
      >
        <Kicker>Your round</Kicker>
        <h1 id="member-round-error-title">We couldn&apos;t load this round</h1>
        <p>Return to your home and try again.</p>
        <TextLink href="/member/home">Home</TextLink>
      </section>
    </main>
  );
}
