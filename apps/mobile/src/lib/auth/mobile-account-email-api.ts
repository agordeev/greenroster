import { createMobileAccountEmailClient } from "./mobile-account-email-client";

import { mobileRuntimeEnv } from "../runtime-env";

export const mobileAccountEmailApi = createMobileAccountEmailClient(
  mobileRuntimeEnv.appUrl,
);
