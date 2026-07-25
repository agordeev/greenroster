import { randomUUID } from "node:crypto";

import { z } from "zod";

const correlationIdSchema = z.uuid();

export function resolveCorrelationId(candidate: string | null | undefined) {
  const parsed = correlationIdSchema.safeParse(candidate);
  return parsed.success ? parsed.data : randomUUID();
}
