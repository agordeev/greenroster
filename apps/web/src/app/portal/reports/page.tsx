import Link from "next/link";
import { redirect } from "next/navigation";
import { z } from "zod";

import { ActionRow, EmptyState, Kicker, TextLink } from "@/components/blocks";
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
      <section
        className="mx-auto mt-6 mb-0 p-[clamp(1.5rem,4vw,3rem)] border max-w-288 bg-card max-[480px]:m-0 max-[480px]:border-0 max-[480px]:min-h-[calc(100vh_-_10rem)] [&>h2+p]:m-0 [&>h2+p]:text-muted-foreground [&>h2+p]:leading-[1.55] [&>h2]:mx-0 [&>h2]:mb-3 [&>h2]:pt-8 [&>h2]:border-t [&>h2]:text-[1.5rem] [&>h2]:font-semibold [&>h2]:mt-12! [&>p:not([data-slot=kicker])]:max-w-168 [&>p:not([data-slot=kicker])]:text-muted-foreground [&>p:not([data-slot=kicker])]:leading-[1.65] [&>p[role='alert']]:mx-0 [&>p[role='alert']]:mt-6 [&>p[role='alert']]:mb-0 [&>p[role='alert']]:p-4 [&>p[role='alert']]:border-l-[0.25rem] [&>p[role='alert']]:border-l-destructive [&>p[role='alert']]:bg-border [&>p[role='alert']]:text-foreground! [&>p[role='alert']]:leading-[1.5]! [&_form:where([data-slot=form-stack],[data-slot=quota-settings-form])]:max-w-184 [&_h1]:mx-0 [&_h1]:mt-2.5 [&_h1]:mb-4 [&_h1]:text-[length:clamp(1.75rem,3vw,2.5rem)] [&_h1]:font-semibold [&_h1]:tracking-[-0.02em] [&_h1]:leading-[1.1]"
        aria-labelledby="reports-title"
      >
        <Kicker>Exports</Kicker>
        <h1 id="reports-title">Reports</h1>
        <p>Download member, standings, and round reports as CSV or PDF.</p>
        <ActionRow>
          <TextLink href="/api/portal/exports?kind=members">
            Members CSV
          </TextLink>
          <TextLink href="/api/portal/exports?kind=members&format=pdf">
            Members PDF
          </TextLink>
          <TextLink href="/api/portal/exports?kind=standings">
            Standings CSV
          </TextLink>
          <TextLink href="/api/portal/exports?kind=standings&format=pdf">
            Standings PDF
          </TextLink>
        </ActionRow>

        <section
          className="mt-10 pt-8 border-t [&>h2]:mx-0 [&>h2]:text-[1.5rem] [&>h2]:font-semibold [&>h2]:mt-1.5! [&>h2]:mb-0!"
          aria-labelledby="round-reports-title"
        >
          <Kicker>Completed rounds</Kicker>
          <h2 id="round-reports-title">Results and score pads</h2>
          {rounds.length === 0 ? (
            <EmptyState>No completed rounds to report on yet.</EmptyState>
          ) : (
            <div className="mt-5 border relative overflow-x-auto bg-card">
              <table className="w-full min-w-192 border-collapse text-left [&_tbody_th]:font-semibold [&_tbody_th]:text-primary! [&_tbody_th]:text-[1.125rem]! [&_tbody_tr:last-child_td]:border-b-0 [&_tbody_tr:last-child_th]:border-b-0 [&_td]:py-[0.9rem] [&_td]:px-3 [&_td]:border-b [&_td]:border-b-border/50 [&_td]:align-top [&_td]:text-[0.8125rem] [&_th]:py-[0.9rem] [&_th]:px-3 [&_th]:border-b [&_th]:border-b-border/50 [&_th]:align-top [&_th]:text-[0.8125rem] [&_thead_th]:text-muted-foreground [&_thead_th]:text-[0.6875rem] [&_thead_th]:tracking-[0.08em] [&_thead_th]:uppercase">
                <caption className="sr-only">Completed round reports</caption>
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
                        <span className="mt-6 flex flex-wrap items-center gap-y-3 gap-x-5">
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
