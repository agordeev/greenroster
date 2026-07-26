import { resolveMobileRecoveryStatus } from "@/lib/auth/mobile-recovery-api";

export async function GET(request: Request) {
  return resolveMobileRecoveryStatus(request);
}
