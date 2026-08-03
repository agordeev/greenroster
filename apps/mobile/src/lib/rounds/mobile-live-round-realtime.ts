import { z } from "zod";

import type {
  MobileLiveRoundScore,
  MobileLiveRoundParticipant,
} from "./mobile-live-round-api";
import {
  applyMobileLiveRoundRealtimeScore,
  createMobileLiveRoundState,
  markMobileLiveRoundFresh,
  markMobileLiveRoundStale,
  replaceMobileLiveRoundSnapshot,
  type MobileLiveRoundState,
  type MobileLiveRoundStateSnapshot,
} from "./mobile-live-round-state";

const uuidSchema = z.uuid();
const numericValueSchema = z
  .union([
    z.number().finite(),
    z.string().regex(/^-?(?:\d+(?:\.\d*)?|\.\d+)$/u),
  ])
  .transform((value) => String(value))
  .nullable();
const versionSchema = z
  .union([z.number().int().nonnegative(), z.string().regex(/^\d+$/u)])
  .transform(Number)
  .refine(Number.isSafeInteger);

const projectionEventSchema = z
  .object({
    participant_id: uuidSchema,
    group_id: uuidSchema,
    round_id: uuidSchema,
    gross_score: numericValueSchema,
    net_score: numericValueSchema,
    golf_points: numericValueSchema,
    manual_merit: numericValueSchema,
    plus_minus: numericValueSchema,
    ranking_value: numericValueSchema,
    version: versionSchema,
    last_revision_id: uuidSchema.nullable(),
    created_at: z.string().datetime({ offset: true }),
    updated_at: z.string().datetime({ offset: true }),
  })
  .strict();

export type MobileLiveRoundRealtimeEvent = Readonly<{
  participantId: string;
  groupId: string;
  roundId: string;
  score: MobileLiveRoundScore;
}>;

export type MobileLiveRoundRealtimeApplyResult = Readonly<{
  state: MobileLiveRoundState;
  status: "applied" | "duplicate" | "gap" | "ignored";
  needsRefetch: boolean;
}>;

export type MobileLiveRoundRealtimeStatus =
  | "current"
  | "stale"
  | "reconnecting"
  | "refetching"
  | "stopped"
  | "locked"
  | "permission_denied";

export type MobileLiveRoundRealtimeErrorCode =
  "permission_denied" | "locked" | "validation" | "unavailable";

export class MobileLiveRoundRealtimeError extends Error {
  readonly code: MobileLiveRoundRealtimeErrorCode;

  constructor(code: MobileLiveRoundRealtimeErrorCode, message: string) {
    super(message);
    this.name = "MobileLiveRoundRealtimeError";
    this.code = code;
  }
}

export type MobileLiveRoundRealtimeView = Readonly<{
  state: MobileLiveRoundState | null;
  status: MobileLiveRoundRealtimeStatus;
  lastEventAt: string | null;
  error: string | null;
  errorCode: MobileLiveRoundRealtimeErrorCode | null;
}>;

function mapProjectionEvent(
  row: z.infer<typeof projectionEventSchema>,
): MobileLiveRoundRealtimeEvent {
  return {
    participantId: row.participant_id,
    groupId: row.group_id,
    roundId: row.round_id,
    score: {
      participantId: row.participant_id,
      version: row.version,
      revisionId: row.last_revision_id,
      grossScore: row.gross_score,
      netScore: row.net_score,
      golfPoints: row.golf_points,
      manualMerit: row.manual_merit,
      plusMinus: row.plus_minus,
      rankingValue: row.ranking_value,
      changedAt: row.updated_at,
    },
  };
}

export function parseMobileLiveRoundRealtimePayload(
  payload: unknown,
): MobileLiveRoundRealtimeEvent | null {
  const row =
    typeof payload === "object" && payload !== null && "new" in payload
      ? (payload as { new?: unknown }).new
      : payload;
  const parsed = projectionEventSchema.safeParse(row);
  return parsed.success ? mapProjectionEvent(parsed.data) : null;
}

export function applyMobileLiveRoundRealtimeEvent(
  state: MobileLiveRoundState,
  event: MobileLiveRoundRealtimeEvent,
): MobileLiveRoundRealtimeApplyResult {
  if (event.roundId !== state.roundId || event.groupId !== state.groupId) {
    return { needsRefetch: false, state, status: "ignored" };
  }
  const participant = state.participants.find(
    (candidate) => candidate.participant.participantId === event.participantId,
  );
  if (!participant) return { needsRefetch: false, state, status: "ignored" };

  const currentVersion = participant.confirmed.version;
  if (event.score.version <= currentVersion) {
    return { needsRefetch: false, state, status: "duplicate" };
  }
  if (event.score.version > currentVersion + 1) {
    return {
      needsRefetch: true,
      state: markMobileLiveRoundStale(state),
      status: "gap",
    };
  }
  return {
    needsRefetch: false,
    state: applyMobileLiveRoundRealtimeScore(state, event.score),
    status: "applied",
  };
}

type MobileRealtimeChannel = Readonly<{
  on: (
    event: "postgres_changes",
    filter: Readonly<{
      event: "*";
      schema: "public";
      table: "participant_score_projections";
      filter: string;
    }>,
    callback: (payload: unknown) => void,
  ) => MobileRealtimeChannel;
  subscribe: (callback?: (status: string) => void) => unknown;
  unsubscribe?: () => Promise<unknown> | unknown;
}>;

type MobileRealtimeClient = Readonly<{
  channel: (name: string) => MobileRealtimeChannel;
}>;

export type MobileLiveRoundRealtimeDependencies = Readonly<{
  client: MobileRealtimeClient;
  groupId: string;
  roundId: string;
  refetch: () => Promise<
    MobileLiveRoundStateSnapshot | readonly MobileLiveRoundParticipant[]
  >;
  initialState?: MobileLiveRoundState | null;
  onChange?: (view: MobileLiveRoundRealtimeView) => void;
  now?: () => string;
}>;

function snapshotFromRefetch(
  snapshot:
    MobileLiveRoundStateSnapshot | readonly MobileLiveRoundParticipant[],
): MobileLiveRoundStateSnapshot {
  if (Array.isArray(snapshot)) {
    return {
      participants: snapshot as readonly MobileLiveRoundParticipant[],
    };
  }
  return snapshot as MobileLiveRoundStateSnapshot;
}

export function createMobileLiveRoundRealtime(
  dependencies: MobileLiveRoundRealtimeDependencies,
) {
  let state = dependencies.initialState ?? null;
  let status: MobileLiveRoundRealtimeStatus = "stopped";
  let lastEventAt: string | null = null;
  let error: string | null = null;
  let errorCode: MobileLiveRoundRealtimeErrorCode | null = null;
  let channel: MobileRealtimeChannel | null = null;
  let refetchInFlight: Promise<void> | null = null;

  const now = dependencies.now ?? (() => new Date().toISOString());
  const notify = () =>
    dependencies.onChange?.({ error, errorCode, lastEventAt, state, status });
  const currentStatus = () => status;

  async function refetch() {
    if (refetchInFlight) return refetchInFlight;
    status = "refetching";
    error = null;
    errorCode = null;
    notify();
    refetchInFlight = dependencies
      .refetch()
      .then((snapshot) => {
        const normalized = snapshotFromRefetch(snapshot);
        state = state
          ? replaceMobileLiveRoundSnapshot(state, normalized)
          : createMobileLiveRoundState(normalized);
        state = markMobileLiveRoundFresh(state, now());
        status = "current";
        error = null;
      })
      .catch((cause: unknown) => {
        const typed =
          cause instanceof MobileLiveRoundRealtimeError
            ? cause
            : new MobileLiveRoundRealtimeError(
                "unavailable",
                cause instanceof Error ? cause.message : "refetch_failed",
              );
        errorCode = typed.code;
        status =
          typed.code === "locked"
            ? "locked"
            : typed.code === "permission_denied"
              ? "permission_denied"
              : "stale";
        state =
          typed.code === "locked" || typed.code === "permission_denied"
            ? state
            : state
              ? markMobileLiveRoundStale(state)
              : state;
        error = typed.message;
      })
      .finally(() => {
        refetchInFlight = null;
        notify();
      });
    return refetchInFlight;
  }

  async function handlePayload(payload: unknown) {
    const event = parseMobileLiveRoundRealtimePayload(payload);
    if (!event || !state) {
      status = "stale";
      errorCode = "unavailable";
      if (state) state = markMobileLiveRoundStale(state);
      error = "invalid_realtime_payload";
      notify();
      await refetch();
      return;
    }
    const result = applyMobileLiveRoundRealtimeEvent(state, event);
    if (result.status === "ignored" || result.status === "duplicate") {
      notify();
      return;
    }
    state = result.state;
    lastEventAt = now();
    if (result.status === "gap") {
      status = "stale";
      errorCode = null;
      error = "realtime_version_gap";
      notify();
      await refetch();
      return;
    }
    status = "current";
    error = null;
    errorCode = null;
    notify();
  }

  return {
    getView(): MobileLiveRoundRealtimeView {
      return { error, errorCode, lastEventAt, state, status };
    },
    setLocalState(nextState: MobileLiveRoundState | null) {
      state = nextState;
    },
    async start() {
      status = "refetching";
      notify();
      await refetch();
      const statusAfterRefetch = currentStatus();
      if (
        statusAfterRefetch === "locked" ||
        statusAfterRefetch === "permission_denied" ||
        statusAfterRefetch === "stopped"
      ) {
        return;
      }
      channel = dependencies.client.channel(
        `mobile-live-round:${dependencies.groupId}:${dependencies.roundId}`,
      );
      channel
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "participant_score_projections",
            filter: `round_id=eq.${dependencies.roundId}`,
          },
          (payload) => void handlePayload(payload),
        )
        .subscribe((nextStatus) => {
          if (nextStatus === "SUBSCRIBED") {
            void refetch();
          } else if (
            nextStatus === "CHANNEL_ERROR" ||
            nextStatus === "TIMED_OUT" ||
            nextStatus === "CLOSED"
          ) {
            status = "reconnecting";
            errorCode = "unavailable";
            error = nextStatus;
            if (state) state = markMobileLiveRoundStale(state);
            notify();
          }
        });
      notify();
    },
    async reconnect() {
      status = "reconnecting";
      if (state) state = markMobileLiveRoundStale(state);
      notify();
      await refetch();
    },
    async refetch() {
      await refetch();
    },
    async stop() {
      if (channel?.unsubscribe) await channel.unsubscribe();
      channel = null;
      status = "stopped";
      error = null;
      errorCode = null;
      notify();
    },
    async handlePayload(payload: unknown) {
      await handlePayload(payload);
    },
  };
}

export const mobileLiveRoundRealtimeEventSchema = projectionEventSchema;
