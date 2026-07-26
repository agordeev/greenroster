import { z } from "zod";

export function resolveBootstrapOperationId(
  storedValue: string | null,
  generate: () => string,
) {
  const stored = z.uuid().safeParse(storedValue);
  return stored.success ? stored.data : generate();
}
