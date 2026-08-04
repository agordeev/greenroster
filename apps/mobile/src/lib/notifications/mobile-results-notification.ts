import { z } from "zod";

import type { MobileLinkDestination } from "@/lib/auth/mobile-link-destination";

const resultsNotificationDataSchema = z
  .object({
    type: z.literal("results_published"),
    roundId: z.uuid(),
  })
  .strict();

export function resolveResultsNotificationDestination(
  data: unknown,
): MobileLinkDestination | null {
  const parsed = resultsNotificationDataSchema.safeParse(data);
  if (!parsed.success) return null;
  return `/rounds?roundId=${parsed.data.roundId}`;
}
