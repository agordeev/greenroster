import { accountEmailApiDependencies } from "../../../../lib/auth/account-email-api";
import { handleAccountEmailRequest } from "../../../../lib/auth/account-email-api-core";

export async function POST(request: Request): Promise<Response> {
  return handleAccountEmailRequest(request, accountEmailApiDependencies);
}
