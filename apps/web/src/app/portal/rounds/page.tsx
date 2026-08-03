import Link from "next/link";
import { redirect } from "next/navigation";
import { isAuthRetryableFetchError } from "@supabase/supabase-js";
import { z } from "zod";

import {
  formatRoundFormat,
  formatRoundSchedule,
  formatRoundState,
  roundDraftFormValue,
  type RoundDraft,
} from "@/domain/round-drafts";
import { roundPublicationReviewKey } from "@/domain/round-publication";
import { signInPath } from "@/lib/auth/safe-return-path";
import { verifyMutationSession } from "@/lib/auth/verify-mutation-session";
import { MutationError } from "@/lib/mutations/result";
import { executeListRoundDrafts } from "@/lib/rounds/round-drafts-data";
import { executePreviewRoundPublication } from "@/lib/rounds/round-publication-data";
import { createServerComponentSupabaseClient } from "@/lib/supabase/server-component-client";

import { PortalShell } from "../portal-shell";
import { RoundWorkspace } from "./round-workspace";

const contextSchema = z
  .array(
    z
      .object({
        membership_id: z.uuid(),
        group_id: z.uuid(),
        role: z.enum(["member", "coordinator", "administrator"]),
      })
      .strict(),
  )
  .max(1);

const groupSchema = z
  .object({ name: z.string(), time_zone: z.string() })
  .strict();

type PortalContext = Readonly<{
  email: string;
  groupId: string;
  groupName: string;
  role: "member" | "coordinator" | "administrator";
  timeZone: string;
}>;

export default async function RoundsPage({
  searchParams,
}: Readonly<{
  searchParams: Promise<
    Readonly<Record<string, string | string[] | undefined>>
  >;
}>) {
  let session: Awaited<ReturnType<typeof verifyMutationSession>>;
  try {
    session = await verifyMutationSession();
  } catch (error) {
    return renderRoundError(error);
  }

  let portalContext: PortalContext;
  try {
    portalContext = await resolvePortalContext();
  } catch (error) {
    return renderRoundError(error);
  }

  if (portalContext.role === "member") {
    return (
      <PortalShell
        email={portalContext.email}
        groupName={portalContext.groupName}
        role={portalContext.role}
        timeZone={portalContext.timeZone}
        currentSection="rounds"
      >
        <section
          className="portal-ledger role-denied"
          aria-labelledby="rounds-denied-title"
        >
          <p className="ledger-kicker">Round administration</p>
          <h1 id="rounds-denied-title">
            Round administration is not available
          </h1>
          <p>
            Your member role can respond to published rounds in the app. Draft
            round configuration is private to coordinators and administrators.
          </p>
          <div className="information-actions">
            <Link className="secondary-link" href="/portal">
              Return to portal home
            </Link>
          </div>
        </section>
      </PortalShell>
    );
  }

  let rounds: readonly RoundDraft[];
  try {
    rounds = await executeListRoundDrafts(session.userId);
  } catch (error) {
    return renderRoundError(error, portalContext);
  }

  const params = await searchParams;
  const requestedRound = Array.isArray(params.round)
    ? params.round[0]
    : params.round;
  const selectedRound = requestedRound
    ? (rounds.find((round) => round.roundId === requestedRound) ?? null)
    : null;
  let publicationReview = null;
  let publicationReviewUnavailable = false;
  if (selectedRound?.state === "draft" && selectedRound.format !== null) {
    try {
      publicationReview = await executePreviewRoundPublication(session.userId, {
        roundId: selectedRound.roundId,
        excludedMembershipIds: [],
      });
    } catch {
      publicationReviewUnavailable = true;
    }
  }
  const newRound: RoundDraft = {
    roundId: "",
    groupId: portalContext.groupId,
    groupTimeZone: portalContext.timeZone,
    description: null,
    scheduledAt: null,
    venue: null,
    roundUrl: null,
    notes: null,
    notesVisibleToPlayers: true,
    rsvpDeadlineAt: null,
    format: null,
    state: "draft",
    version: 1,
  };

  return (
    <PortalShell
      email={portalContext.email}
      groupName={portalContext.groupName}
      role={portalContext.role}
      timeZone={portalContext.timeZone}
      currentSection="rounds"
    >
      <section className="portal-ledger" aria-labelledby="rounds-title">
        <div className="group-panel-heading">
          <div>
            <p className="ledger-kicker">Round administration</p>
            <h1 id="rounds-title">Rounds</h1>
          </div>
          <p>{rounds.length} configured</p>
        </div>
        <p>
          Drafts stay private until the later publication review. Local times
          use the group time zone, <strong>{portalContext.timeZone}</strong>.
        </p>

        <RoundWorkspace
          key={`round-workspace:${selectedRound?.roundId ?? "new"}:${selectedRound?.version ?? 0}:${publicationReview ? roundPublicationReviewKey(publicationReview) : "unavailable"}`}
          identityKey={`${portalContext.groupId}:${selectedRound?.roundId ?? "new"}`}
          initialValue={roundDraftFormValue(selectedRound ?? newRound)}
          roundId={
            selectedRound?.state === "draft" ? selectedRound.roundId : null
          }
          format={
            selectedRound?.state === "draft" ? selectedRound.format : null
          }
          publicationReview={publicationReview}
          publicationReviewUnavailable={publicationReviewUnavailable}
        />

        <section
          className="group-roles-panel"
          aria-labelledby="round-list-title"
        >
          <div className="group-panel-heading">
            <div>
              <p className="ledger-kicker">Round list</p>
              <h2 id="round-list-title">Configured rounds</h2>
            </div>
          </div>
          {rounds.length === 0 ? (
            <p className="group-empty" role="status">
              No rounds yet. Save a private draft above to start the first one.
            </p>
          ) : (
            <ul className="group-role-list">
              {rounds.map((round) => (
                <li key={round.roundId} className="group-role-row">
                  <div>
                    <Link
                      className="group-role-name"
                      href={`/portal/rounds?round=${encodeURIComponent(round.roundId)}`}
                    >
                      {round.description || "Untitled draft"}
                    </Link>
                    <p>
                      {formatRoundState(round.state)} ·{" "}
                      {formatRoundFormat(round.format)} · Version{" "}
                      {round.version}
                    </p>
                  </div>
                  <div className="group-role-meta">
                    <span>
                      {formatRoundSchedule(
                        round.scheduledAt,
                        round.groupTimeZone,
                      )}
                    </span>
                    <span>{round.groupTimeZone}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </section>
    </PortalShell>
  );
}

async function resolvePortalContext(): Promise<PortalContext> {
  const supabase = await createServerComponentSupabaseClient();
  let userResult: Awaited<ReturnType<typeof supabase.auth.getUser>>;
  try {
    userResult = await supabase.auth.getUser();
  } catch (error) {
    throw new MutationError("transient", { cause: error });
  }
  if (userResult.error && isAuthRetryableFetchError(userResult.error)) {
    throw new MutationError("transient", { cause: userResult.error });
  }
  if (userResult.error || !userResult.data.user?.email) {
    throw new MutationError("authentication_required", {
      cause: userResult.error,
    });
  }

  const contextResult = await supabase.rpc("resolve_identity_context");
  const parsedContext = contextSchema.safeParse(contextResult.data);
  const context = parsedContext.success ? parsedContext.data[0] : undefined;
  if (contextResult.error || !parsedContext.success || !context) {
    throw new MutationError("forbidden", { cause: contextResult.error });
  }

  const groupResult = await supabase
    .from("groups")
    .select("name,time_zone")
    .eq("id", context.group_id)
    .single();
  const parsedGroup = groupSchema.safeParse(groupResult.data);
  if (groupResult.error || !parsedGroup.success) {
    throw new MutationError("transient", { cause: groupResult.error });
  }

  return {
    email: userResult.data.user.email,
    groupId: context.group_id,
    groupName: parsedGroup.data.name,
    role: context.role,
    timeZone: parsedGroup.data.time_zone,
  };
}

function renderRoundError(error: unknown, context?: PortalContext) {
  if (
    error instanceof MutationError &&
    error.code === "authentication_required"
  ) {
    redirect(signInPath("/portal/rounds"));
  }

  const forbidden =
    error instanceof MutationError && error.code === "forbidden";
  return (
    <PortalShell
      email={context?.email ?? "Signed-in account"}
      groupName={context?.groupName ?? "Current group"}
      {...(context
        ? { role: context.role, timeZone: context.timeZone }
        : { roleStatus: "Access unavailable", timeZone: "" })}
      currentSection="rounds"
    >
      <section className="portal-ledger" aria-labelledby="round-error-title">
        <p className="ledger-kicker">Round administration</p>
        <h1 id="round-error-title">
          {forbidden
            ? "Round administration is not available"
            : "Rounds could not be loaded"}
        </h1>
        <p>
          {forbidden
            ? "Your current membership does not have coordinator or administrator access."
            : "The round service is temporarily unavailable. Refresh and try again."}
        </p>
      </section>
    </PortalShell>
  );
}
