import { exchangeMobileRecoveryCode } from "@/lib/auth/mobile-recovery-api";

export async function POST(request: Request) {
  return exchangeMobileRecoveryCode(request);
}
