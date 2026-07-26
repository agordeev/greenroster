import { z } from "zod";

export const webFirstRunInputSchema = z
  .object({
    firstName: z.string().trim().min(1).max(100),
    lastName: z.string().trim().min(1).max(100),
    termsVersion: z.string().trim().min(1).max(100),
    privacyVersion: z.string().trim().min(1).max(100),
    acceptedTerms: z.literal(true),
    acceptedPrivacy: z.literal(true),
    operationId: z.uuid(),
  })
  .strict();

export type WebFirstRunInput = z.infer<typeof webFirstRunInputSchema>;
