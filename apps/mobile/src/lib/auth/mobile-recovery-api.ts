import { createMobileRecoveryClient } from "./mobile-recovery-client";

import { mobileRuntimeEnv } from "@/lib/runtime-env";

export const mobileRecoveryApi = createMobileRecoveryClient(
  mobileRuntimeEnv.appUrl,
);
