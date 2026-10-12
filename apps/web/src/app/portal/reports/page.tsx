import Link from "next/link";
import { redirect } from "next/navigation";
import { z } from "zod";

import { ActionRow, EmptyState } from "@/components/blocks";
import { Button } from "@/components/ui/button";
import { signInPath } from "@/lib/auth/safe-return-path";
import { verifyMutationSession } from "@/lib/auth/verify-mutation-session";
import { createServerComponentSupabaseClient } from "@/lib/supabase/server-component-client";

import { PortalShell } from "../portal-shell";

const contextSchema = z
  .array(
    z.object({
      group_id: z.uuid(),
      role: z.enum(["member", "coordinator", "administrator"]),
    }),
  )
  .max(1);
const groupSchema = z.object({ name: z.string(), time_zone: z.string() });
const roundSchema = z.object({
  id: z.uuid(),
  description: z.string().nullable(),
  scheduled_at: z.string().nullable(),
});

export default async function PortalReportsPage() {
  try {
    await verifyMutationSession();
  } catch {
    redirect(signInPath("/portal/reports"));
  }
  const supabase = await createServerComponentSupabaseClient();
  const contextResult = await supabase.rpc("resolve_identity_context");
  const context = contextSchema.safeParse(contextResult.data).data?.[0];
  if (contextResult.error || !context) redirect("/portal");
  if (context.role === "member") redirect("/home");

  const [userResult, groupResult, roundsResult] = await Promise.all([
    supabase.auth.getUser(),
    supabase
      .from("groups")
      .select("name,time_zone")
      .eq("id", context.group_id)
      .single(),
    supabase
      .from("rounds")
      .select("id,description,scheduled_at")
      .eq("group_id", context.group_id)
      .eq("state", "completed")
      .order("scheduled_at", { ascending: false })
      .limit(50),
  ]);
  const group = groupSchema.safeParse(groupResult.data).data;
  const rounds = z.array(roundSchema).safeParse(roundsResult.data).data ?? [];
  if (userResult.error || !userResult.data.user || !group) redirect("/portal");

  return (
    <PortalShell
      email={userResult.data.user.email ?? "Signed-in account"}
      groupName={group.name}
      role={context.role}
      timeZone={group.time_zone}
      currentSection="reports"
    >
      <section className="portal-ledger" aria-labelledby="reports-title">
        <p className="ledger-kicker">Exports</p>
        <h1 id="reports-title">Reports</h1>
        <p>Download member, standings, and round reports as CSV or PDF.</p>
        <ActionRow>
          <Link
            className="secondary-link"
            href="/api/portal/exports?kind=members"
          >
            Members CSV
          </Link>
          <Link
            className="secondary-link"
            href="/api/portal/exports?kind=members&format=pdf"
          >
            Members PDF
          </Link>
          <Link
            className="secondary-link"
            href="/api/portal/exports?kind=standings"
          >
            Standings CSV
          </Link>
          <Link
            className="secondary-link"
            href="/api/portal/exports?kind=standings&format=pdf"
          >
            Standings PDF
          </Link>
        </ActionRow>

        <section className="page-section" aria-labelledby="round-reports-title">
          <p className="ledger-kicker">Completed rounds</p>
          <h2 id="round-reports-title">Results and score pads</h2>
          {rounds.length === 0 ? (
            <EmptyState>No completed rounds to report on yet.</EmptyState>
          ) : (
            <div className="member-results-table-wrap">
              <table className="member-results-table">
                <caption className="visually-hidden">
                  Completed round reports
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Round</th>
                    <th scope="col">Scheduled</th>
                    <th scope="col">Reports</th>
                  </tr>
                </thead>
                <tbody>
                  {rounds.map((round) => (
                    <tr key={round.id}>
                      <th scope="row">{round.description ?? "Round"}</th>
                      <td>{round.scheduled_at ?? "-"}</td>
                      <td>
                        <span className="action-row">
                          <Button asChild variant="link" size="inline">
                            <Link
                              href={`/api/portal/exports?kind=results&round_id=${round.id}`}
                            >
                              CSV
                            </Link>
                          </Button>
                          <Button asChild variant="link" size="inline">
                            <Link
                              href={`/api/portal/exports?kind=results&format=pdf&round_id=${round.id}`}
                            >
                              Results PDF
                            </Link>
                          </Button>
                          <Button asChild variant="link" size="inline">
                            <Link
                              href={`/api/portal/exports?kind=scorepad&format=pdf&round_id=${round.id}`}
                            >
                              Score pad PDF
                            </Link>
                          </Button>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </section>
    </PortalShell>
  );
}
