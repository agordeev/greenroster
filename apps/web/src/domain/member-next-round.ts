import { z } from "zod";

const positiveIntegerSchema = z
  .union([z.number().int().positive(), z.string().regex(/^\d+$/u)])
  .transform((value) => Number(value))
  .refine(Number.isSafeInteger, "Invalid positive integer.");

const instantSchema = z.string().datetime({ offset: true });

const memberNextRoundParticipantSchema = z
  .object({
    rsvp_status: z.enum(["no_response", "playing", "not_playing"]),
    version: positiveIntegerSchema,
    changed_at: instantSchema.nullable(),
  })
  .strict();

export const memberNextRoundEnvelopeSchema = z
  .object({
    round_id: z.uuid(),
    group_id: z.uuid(),
    description: z.string().nullable(),
    scheduled_at: instantSchema,
    group_time_zone: z.string().min(1),
    venue: z.string().nullable(),
    notes: z.string().max(500).nullable(),
    format: z.enum(["individual_net", "individual_gross"]),
    rsvp_deadline_at: instantSchema.nullable(),
    participant: memberNextRoundParticipantSchema,
  })
  .strict();

export type MemberNextRoundEnvelope = z.infer<
  typeof memberNextRoundEnvelopeSchema
>;

export type MemberNextRound = Readonly<{
  roundId: string;
  groupId: string;
  description: string | null;
  scheduledAt: string;
  groupTimeZone: string;
  venue: string | null;
  notes: string | null;
  format: "individual_net" | "individual_gross";
  rsvpDeadlineAt: string | null;
  participant: Readonly<{
    rsvpStatus: "no_response" | "playing" | "not_playing";
    version: number;
    changedAt: string | null;
  }>;
}>;

export function memberNextRoundFromEnvelope(
  envelope: MemberNextRoundEnvelope,
): MemberNextRound {
  return {
    roundId: envelope.round_id,
    groupId: envelope.group_id,
    description: envelope.description,
    scheduledAt: envelope.scheduled_at,
    groupTimeZone: envelope.group_time_zone,
    venue: envelope.venue,
    notes: envelope.notes,
    format: envelope.format,
    rsvpDeadlineAt: envelope.rsvp_deadline_at,
    participant: {
      rsvpStatus: envelope.participant.rsvp_status,
      version: envelope.participant.version,
      changedAt: envelope.participant.changed_at,
    },
  };
}
