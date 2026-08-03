import { redirect } from "next/navigation";
import Link from "next/link";
import { z } from "zod";

import type { MemberNextRound } from "@/domain/member-next-round";
import { executeReadMemberNextRound } from "@/lib/rounds/member-next-round-data";
import { resolveMemberPageSession } from "@/lib/auth/member-page-session";
import { signInPath } from "@/lib/auth/safe-return-path";

import { MemberNextRoundRsvp } from "./member-next-round-rsvp";

const firstRunSchema = z
  .array(z.object({ is_complete: z.boolean() }))
  .length(1);

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

  return (
    <main className="auth-shell auth-shell-single invitation-shell">
      <section className="auth-ledger" aria-labelledby="member-home-title">
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
                Your next published round will appear here when your group opens
                RSVP.
              </p>
            </section>
          )}
          <Link className="secondary-link" href="/account">
            Manage account e-mail
          </Link>
        </div>
      </section>
    </main>
  );
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
    <main className="auth-shell auth-shell-single invitation-shell">
      <section className="auth-ledger">
        <p className="ledger-kicker">Member home</p>
        <h1>Your membership could not be loaded</h1>
        <p>Try again in a moment or ask a group coordinator for help.</p>
      </section>
    </main>
  );
}
