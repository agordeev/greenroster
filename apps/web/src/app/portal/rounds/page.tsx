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
import { executeReadCoordinatorRoundDetail } from "@/lib/rounds/round-detail-data";
import { executeReadLiveRoundScores } from "@/lib/rounds/live-round-score-data";
import { executeReadRoundHoleScorecard } from "@/lib/rounds/round-hole-scorecard-data";
import { executeReadMemberOfficialResults } from "@/lib/rounds/member-results-data";
import { executePreviewLiveRoundCompletion } from "@/lib/rounds/round-completion-data";
import { executePreviewRoundPublication } from "@/lib/rounds/round-publication-data";
import { createServerComponentSupabaseClient } from "@/lib/supabase/server-component-client";
import { executeReadRoundMessages } from "@/lib/clubhouse/clubhouse-content-data";
import {
  ActionRow,
  EmptyState,
  Kicker,
  portalPanelClass,
  SectionHeading,
  TextLink,
} from "@/components/blocks";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

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
          className={portalPanelClass}
          aria-labelledby="rounds-denied-title"
        >
          <Kicker>Coordinator access</Kicker>
          <h1 id="rounds-denied-title">
            Only coordinators and administrators manage rounds
          </h1>
          <p>You can respond to published rounds in the app.</p>
          <ActionRow>
            <TextLink href="/portal">Return to portal home</TextLink>
          </ActionRow>
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
  let roundDetail = null;
  let roundDetailUnavailable = false;
  if (selectedRound && selectedRound.state !== "draft") {
    try {
      roundDetail = await executeReadCoordinatorRoundDetail(
        session.userId,
        selectedRound.roundId,
      );
    } catch {
      roundDetailUnavailable = true;
    }
  }
  let roundMessages = [] as Awaited<
    ReturnType<typeof executeReadRoundMessages>
  >;
  if (
    selectedRound &&
    ["published", "live", "completed"].includes(selectedRound.state)
  ) {
    try {
      roundMessages = await executeReadRoundMessages(
        session.userId,
        selectedRound.roundId,
      );
    } catch {
      roundMessages = [];
    }
  }
  let liveScores = [] as Awaited<ReturnType<typeof executeReadLiveRoundScores>>;
  let liveScoresUnavailable = false;
  if (selectedRound?.state === "live") {
    try {
      liveScores = await executeReadLiveRoundScores(
        session.userId,
        selectedRound.roundId,
      );
    } catch {
      liveScoresUnavailable = true;
    }
  }
  let holeScores = [] as Awaited<
    ReturnType<typeof executeReadRoundHoleScorecard>
  >;
  let holeScoresUnavailable = false;
  if (
    selectedRound &&
    selectedRound.state !== "draft" &&
    selectedRound.state !== "cancelled"
  ) {
    try {
      holeScores = await executeReadRoundHoleScorecard(
        session.userId,
        selectedRound.roundId,
      );
    } catch {
      holeScoresUnavailable = true;
    }
  }
  let completionPreview = null as Awaited<
    ReturnType<typeof executePreviewLiveRoundCompletion>
  > | null;
  let completionPreviewUnavailable = false;
  if (selectedRound?.state === "live") {
    if (!roundDetail) {
      completionPreviewUnavailable = true;
    } else {
      try {
        completionPreview = await executePreviewLiveRoundCompletion(
          session.userId,
          {
            roundId: selectedRound.roundId,
            groupId: roundDetail.groupId,
          },
        );
      } catch {
        completionPreviewUnavailable = true;
      }
    }
  }
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
  let officialResults = null as Awaited<
    ReturnType<typeof executeReadMemberOfficialResults>
  > | null;
  let officialResultsUnavailable = false;
  if (selectedRound?.state === "completed") {
    try {
      officialResults = await executeReadMemberOfficialResults(
        session.userId,
        selectedRound.roundId,
      );
    } catch {
      officialResultsUnavailable = true;
    }
  }
  const creating = !selectedRound && params.new !== undefined;
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
      <section className={portalPanelClass} aria-labelledby="rounds-title">
        {selectedRound || creating ? (
          <>
            <TextLink href="/portal/rounds">← All rounds</TextLink>
            <div className="mt-5 mb-4 flex flex-wrap items-center gap-x-4 gap-y-2">
              <h1 id="rounds-title" className="m-0!">
                {selectedRound?.description || "New round"}
              </h1>
              {selectedRound ? (
                <Badge variant="outline">
                  {formatRoundState(selectedRound.state)}
                </Badge>
              ) : null}
            </div>
          </>
        ) : (
          <>
            <h1 id="rounds-title">Rounds</h1>
            <ActionRow>
              <Button asChild>
                <Link href="/portal/rounds?new=1">New round</Link>
              </Button>
            </ActionRow>
          </>
        )}

        {selectedRound || creating ? (
          <RoundWorkspace
            key={`round-workspace:${selectedRound?.roundId ?? "new"}:${selectedRound?.version ?? 0}:${publicationReview ? roundPublicationReviewKey(publicationReview) : "unavailable"}`}
            identityKey={`${portalContext.groupId}:${selectedRound?.roundId ?? "new"}`}
            initialValue={roundDraftFormValue(selectedRound ?? newRound)}
            roundId={selectedRound?.roundId ?? null}
            format={selectedRound?.format ?? null}
            description={selectedRound?.description ?? "this round"}
            state={selectedRound?.state ?? "draft"}
            version={selectedRound?.version ?? 1}
            publicationReview={publicationReview}
            publicationReviewUnavailable={publicationReviewUnavailable}
            roundDetail={roundDetail}
            roundDetailUnavailable={roundDetailUnavailable}
            roundMessages={roundMessages}
            liveScores={liveScores}
            liveScoresUnavailable={liveScoresUnavailable}
            holeScores={holeScores}
            holeScoresUnavailable={holeScoresUnavailable}
            officialResults={officialResults}
            officialResultsUnavailable={officialResultsUnavailable}
            completionPreview={completionPreview}
            completionPreviewUnavailable={completionPreviewUnavailable}
          />
        ) : (
          <section
            className="mt-10 pt-8 border-t [&>h2]:mx-0 [&>h2]:text-[1.5rem] [&>h2]:font-semibold [&>h2]:mt-1.5! [&>h2]:mb-0!"
            aria-labelledby="round-list-title"
          >
            <SectionHeading
              title="Your rounds"
              titleId="round-list-title"
              meta={
                <>
                  {rounds.length} {rounds.length === 1 ? "round" : "rounds"}
                </>
              }
            />
            {rounds.length === 0 ? (
              <EmptyState>No rounds yet. Create your first one.</EmptyState>
            ) : (
              <ul className="mx-0 mt-6 mb-0 p-0 gap-3 grid list-none">
                {rounds.map((round) => (
                  <li
                    key={round.roundId}
                    className="p-4 gap-4 border border-border/50 flex items-center justify-between rounded-lg max-[720px]:items-start max-[720px]:flex-col [&_p]:mx-0 [&_p]:mb-0 [&_p]:text-muted-foreground [&_p]:mt-[0.35rem]! [&_p]:text-[0.8125rem]!"
                  >
                    <div>
                      <Link
                        className="text-primary text-[1.125rem] font-semibold underline-offset-[0.2em]"
                        href={`/portal/rounds?round=${encodeURIComponent(round.roundId)}`}
                      >
                        {round.description || "Untitled round"}
                      </Link>
                      <p>
                        {formatRoundState(round.state)} ·{" "}
                        {formatRoundFormat(round.format)}
                      </p>
                    </div>
                    <div
                      className="gap-1 grid text-muted-foreground text-[0.75rem] text-right max-[720px]:text-left [&_time]:text-muted-foreground [&_time]:text-[0.6875rem]"
                      data-slot="row-meta"
                    >
                      <span>
                        {formatRoundSchedule(
                          round.scheduledAt,
                          round.groupTimeZone,
                        )}
                      </span>
                      {round.state === "completed" ? (
                        <span className="mt-6 flex flex-wrap items-center gap-y-3 gap-x-5">
                          <Button asChild variant="link" size="inline">
                            <Link
                              href={`/api/portal/exports?kind=results&round_id=${round.roundId}`}
                            >
                              Results CSV
                            </Link>
                          </Button>
                          <Button asChild variant="link" size="inline">
                            <Link
                              href={`/api/portal/exports?kind=results&format=pdf&round_id=${round.roundId}`}
                            >
                              Results PDF
                            </Link>
                          </Button>
                          <Button asChild variant="link" size="inline">
                            <Link
                              href={`/api/portal/exports?kind=scorepad&format=pdf&round_id=${round.roundId}`}
                            >
                              Score pad PDF
                            </Link>
                          </Button>
                        </span>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
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
      <section className={portalPanelClass} aria-labelledby="round-error-title">
        <h1 id="round-error-title">
          {forbidden
            ? "Only coordinators and administrators manage rounds"
            : "Rounds could not be loaded"}
        </h1>
        <p>
          {forbidden
            ? "You can respond to published rounds in the app."
            : "Refresh the page and try again."}
        </p>
      </section>
    </PortalShell>
  );
}
