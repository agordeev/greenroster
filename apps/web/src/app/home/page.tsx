import { redirect } from "next/navigation";

import { createServerComponentSupabaseClient } from "@/lib/supabase/server-component-client";

// Older links and e-mails point here. Signed-in people go on to the portal,
// which sends members to their own home; everyone else signs in first.
export default async function HomePage() {
  redirect((await isSignedIn()) ? "/portal" : "/sign-in");
}

async function isSignedIn() {
  try {
    const client = await createServerComponentSupabaseClient();
    const { data, error } = await client.auth.getUser();
    return !error && Boolean(data.user?.email_confirmed_at);
  } catch {
    return false;
  }
}
