import { z } from "zod";

const recoveryRowSchema = z.object({
  claim_id: z.uuid().nullable(),
  consumed_at: z.iso.datetime({ offset: true }).nullable(),
  expires_at: z.iso.datetime({ offset: true }),
});

export type PasswordRecoveryState =
  "none" | "active" | "claimed" | "expired" | "consumed" | "unavailable";

export function passwordRecoveryStateFromRow(
  row: unknown,
  now: Date,
): PasswordRecoveryState {
  if (row === null) return "none";

  const parsed = recoveryRowSchema.safeParse(row);
  if (!parsed.success) return "unavailable";
  if (parsed.data.consumed_at) return "consumed";
  if (new Date(parsed.data.expires_at) <= now) return "expired";
  return parsed.data.claim_id ? "claimed" : "active";
}
