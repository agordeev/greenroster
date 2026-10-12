import { z } from "zod";

export const roundFormats = ["individual_net", "individual_gross"] as const;
export type RoundFormat = (typeof roundFormats)[number];

export const roundStates = [
  "draft",
  "published",
  "live",
  "completed",
  "cancelled",
] as const;
export type RoundState = (typeof roundStates)[number];

const uuidSchema = z.uuid();
const localDateTimeSchema = z
  .string()
  .trim()
  .refine(isLocalDateTimeOrBlank, "Enter a valid local date and time.");
const roundUrlSchema = z
  .string()
  .trim()
  .refine(
    (value) =>
      value === "" || /^https:\/\/[^/?#\s]+(?:[/?#][^\s]*)?$/u.test(value),
    "Use an https:// URL.",
  );

const sharedRoundDraftInput = {
  description: z.string().trim(),
  scheduledLocal: localDateTimeSchema,
  venue: z.string().trim(),
  roundUrl: roundUrlSchema,
  notes: z.string().trim().max(500, "Keep notes to 500 characters or fewer."),
  notesVisibleToPlayers: z.boolean(),
  rsvpDeadlineLocal: localDateTimeSchema,
  format: z.enum(roundFormats),
  operationId: uuidSchema,
} as const;

export const createRoundDraftInputSchema = z
  .object(sharedRoundDraftInput)
  .strict();

export const updateRoundDraftInputSchema = z
  .object({
    ...sharedRoundDraftInput,
    roundId: uuidSchema,
    expectedRoundVersion: z.number().int().positive(),
  })
  .strict();

export type CreateRoundDraftInput = z.infer<typeof createRoundDraftInputSchema>;
export type UpdateRoundDraftInput = z.infer<typeof updateRoundDraftInputSchema>;

export type RoundDraft = Readonly<{
  roundId: string;
  groupId: string;
  groupName?: string;
  groupTimeZone: string;
  description: string | null;
  scheduledAt: string | null;
  venue: string | null;
  roundUrl: string | null;
  notes: string | null;
  notesVisibleToPlayers: boolean;
  rsvpDeadlineAt: string | null;
  format: RoundFormat | null;
  enableGrossScore?: boolean;
  enableNetScore?: boolean;
  state: RoundState;
  version: number;
  createdAt?: string;
  updatedAt?: string;
}>;

export type RoundDraftFormValue = Readonly<{
  roundId?: string;
  groupTimeZone: string;
  description: string;
  scheduledLocal: string;
  venue: string;
  roundUrl: string;
  notes: string;
  notesVisibleToPlayers: boolean;
  rsvpDeadlineLocal: string;
  format: RoundFormat;
  enableGrossScore?: boolean;
  enableNetScore?: boolean;
  state: RoundState;
  version: number;
}>;

export function isLocalDateTimeOrBlank(value: string): boolean {
  if (value === "") return true;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/u.test(value)) return false;

  const [date, time] = value.split("T");
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const candidate = new Date(Date.UTC(year, month - 1, day, hour, minute));
  return (
    candidate.getUTCFullYear() === year &&
    candidate.getUTCMonth() === month - 1 &&
    candidate.getUTCDate() === day &&
    candidate.getUTCHours() === hour &&
    candidate.getUTCMinutes() === minute
  );
}

export function roundDraftFormValue(round: RoundDraft): RoundDraftFormValue {
  return {
    ...(round.roundId ? { roundId: round.roundId } : {}),
    groupTimeZone: round.groupTimeZone,
    description: round.description ?? "",
    scheduledLocal: toLocalDateTimeInput(
      round.scheduledAt,
      round.groupTimeZone,
    ),
    venue: round.venue ?? "",
    roundUrl: round.roundUrl ?? "",
    notes: round.notes ?? "",
    notesVisibleToPlayers: round.notesVisibleToPlayers,
    rsvpDeadlineLocal: toLocalDateTimeInput(
      round.rsvpDeadlineAt,
      round.groupTimeZone,
    ),
    format: round.format ?? "individual_net",
    ...(round.enableGrossScore !== undefined
      ? { enableGrossScore: round.enableGrossScore }
      : {}),
    ...(round.enableNetScore !== undefined
      ? { enableNetScore: round.enableNetScore }
      : {}),
    state: round.state,
    version: round.version,
  };
}

export function toLocalDateTimeInput(
  isoInstant: string | null,
  timeZone: string,
): string {
  if (!isoInstant) return "";
  const date = new Date(isoInstant);
  if (Number.isNaN(date.getTime())) return "";

  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date);
    const values = Object.fromEntries(
      parts
        .filter((part) => part.type !== "literal")
        .map((part) => [part.type, part.value]),
    );
    return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}`;
  } catch {
    return "";
  }
}

export function formatRoundSchedule(
  isoInstant: string | null,
  timeZone: string,
): string {
  if (!isoInstant) return "Not scheduled";
  const date = new Date(isoInstant);
  if (Number.isNaN(date.getTime())) return "Not scheduled";
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone,
      dateStyle: "medium",
      timeStyle: "short",
    }).format(date);
  } catch {
    return "Not scheduled";
  }
}

export function formatRoundFormat(format: RoundFormat | null): string {
  return format === "individual_gross"
    ? "Individual Gross"
    : format === "individual_net"
      ? "Individual Net"
      : "Format not selected";
}

export function formatRoundState(state: RoundState): string {
  return state.charAt(0).toUpperCase() + state.slice(1);
}
