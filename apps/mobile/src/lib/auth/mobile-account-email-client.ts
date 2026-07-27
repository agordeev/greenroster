import { z } from "zod";

const accountEmailResponseSchema = z.discriminatedUnion("ok", [
  z.object({
    correlationId: z.uuid(),
    ok: z.literal(true),
    status: z.literal("pending"),
  }),
  z.object({
    code: z.enum([
      "authentication_required",
      "forbidden",
      "rate_limited",
      "unavailable",
      "validation",
    ]),
    correlationId: z.uuid(),
    fieldErrors: z.record(z.string(), z.array(z.string())).optional(),
    ok: z.literal(false),
  }),
]);

export type MobileAccountEmailApiResult = z.infer<
  typeof accountEmailResponseSchema
>;

export function createMobileAccountEmailClient(
  appUrl: string,
  fetchImplementation: typeof fetch = fetch,
) {
  return {
    async requestEmailChange(
      accessToken: string,
      email: string,
      confirmed: boolean,
    ): Promise<MobileAccountEmailApiResult> {
      try {
        const response = await fetchImplementation(
          `${appUrl}/api/auth/account-email`,
          {
            body: JSON.stringify({ confirmed, email }),
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
            },
            method: "POST",
          },
        );
        const parsed = accountEmailResponseSchema.safeParse(
          await response.json(),
        );
        if (parsed.success) return parsed.data;
      } catch {
        // The action maps malformed and unavailable transport responses to a
        // single safe service-unavailable message.
      }

      return {
        code: "unavailable",
        correlationId: "00000000-0000-4000-8000-000000000000",
        ok: false,
      };
    },
  };
}
