import { z } from "zod";

import { MINIMUM_PASSWORD_LENGTH } from "../auth/auth-validation";

export const invitationRegistrationSchema = z
  .object({
    email: z.string().trim().toLowerCase().pipe(z.email()),
    password: z.string().min(MINIMUM_PASSWORD_LENGTH),
    confirmPassword: z.string().min(1),
  })
  .refine((value) => value.password === value.confirmPassword, {
    message: "Passwords do not match.",
    path: ["confirmPassword"],
  });
