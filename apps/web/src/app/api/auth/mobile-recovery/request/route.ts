import { requestMobileRecovery } from "@/lib/auth/mobile-recovery-api";

export async function POST(request: Request) {
  return requestMobileRecovery(request);
}
