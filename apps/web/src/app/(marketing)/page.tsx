import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { createServerComponentSupabaseClient } from "@/lib/supabase/server-component-client";

import { LandingPage } from "./landing";

export const metadata: Metadata = {
  title: "GreenRoster · Run your golf group’s quota game",
  description:
    "Post your rounds, enter each player’s points, and get results, quotas and Order of Merit standings worked out for you.",
  alternates: { canonical: "/" },
};

// Signed-out visitors see the landing page. Anyone signed in goes straight to
// the portal, the same place sign-in sends them.
export default async function RootPage() {
  if (await isSignedIn()) redirect("/portal");
  return <LandingPage />;
}

async function isSignedIn() {
  try {
    const client = await createServerComponentSupabaseClient();
    const { data, error } = await client.auth.getUser();
    return !error && Boolean(data.user?.email_confirmed_at);
  } catch {
    // If the check fails, show the landing page rather than an error.
    return false;
  }
}
