import { z } from "zod";

import type { MobileLinkDestination } from "@/lib/auth/mobile-link-destination";

const notificationDataSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("results_published"),
      roundId: z.uuid(),
    })
    .strict(),
  z
    .object({
      type: z.literal("round_cancelled"),
      roundId: z.uuid(),
      summary: z.string().min(1),
    })
    .strict(),
]);

export function resolveResultsNotificationDestination(
  data: unknown,
): MobileLinkDestination | null {
  const parsed = notificationDataSchema.safeParse(data);
  if (!parsed.success) return null;
  return `/rounds?roundId=${parsed.data.roundId}`;
}
