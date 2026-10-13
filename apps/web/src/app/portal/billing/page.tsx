import { redirect } from "next/navigation";
import { z } from "zod";

import { executeReadBillingPortal } from "@/lib/billing/billing-data";
import { verifyMutationSession } from "@/lib/auth/verify-mutation-session";
import { createServerComponentSupabaseClient } from "@/lib/supabase/server-component-client";
import { PortalShell } from "../portal-shell";
import { BillingActions } from "./billing-actions";
import { BillingEntitlementForm } from "./entitlement-form";
import { Kicker, portalPanelClass, TextLink } from "@/components/blocks";

const contextSchema = z
  .array(
    z.object({
      group_id: z.uuid(),
      role: z.enum(["member", "coordinator", "administrator"]),
    }),
  )
  .max(1);

export default async function BillingPage() {
  let session: Awaited<ReturnType<typeof verifyMutationSession>>;
  try {
    session = await verifyMutationSession();
  } catch {
    redirect("/sign-in?next=%2Fportal%2Fbilling");
  }
  const supabase = await createServerComponentSupabaseClient();
  const contextResult = await supabase.rpc("resolve_identity_context");
  const context = contextSchema.safeParse(contextResult.data).success
    ? contextSchema.parse(contextResult.data)[0]
    : undefined;
  if (!context || context.role !== "administrator") {
    return (
      <PortalShell
        email={session.userId}
        groupName="Your group"
        role={context?.role}
        timeZone="UTC"
        currentSection="billing"
      >
        <section
          className={portalPanelClass}
          aria-labelledby="billing-denied-title"
        >
          <Kicker>Billing</Kicker>
          <h1 id="billing-denied-title">You cannot manage billing</h1>
          <p>Only administrators can manage the plan and member access.</p>
          <TextLink href="/portal">Return to portal home</TextLink>
        </section>
      </PortalShell>
    );
  }
  const [groupResult, userResult, billing] = await Promise.all([
    supabase
      .from("groups")
      .select("name,time_zone")
      .eq("id", context.group_id)
      .single(),
    supabase.auth.getUser(),
    executeReadBillingPortal(session.userId),
  ]);
  if (groupResult.error || userResult.error || !userResult.data.user) {
    return <BillingError />;
  }
  const snapshot = billing.snapshot;
  const timeZone = groupResult.data.time_zone;
  return (
    <PortalShell
      email={userResult.data.user.email ?? ""}
      groupName={groupResult.data.name}
      role="administrator"
      timeZone={groupResult.data.time_zone}
      currentSection="billing"
    >
      <section className={portalPanelClass} aria-labelledby="billing-title">
        <h1 id="billing-title">Billing</h1>
        <p>See your trial, payment status, member access, and invoices.</p>

        <div className="mt-8 gap-3 grid grid-cols-4 max-[800px]:grid-cols-2 max-[480px]:grid-cols-[1fr]">
          <div className="p-5 gap-[0.4rem] border grid content-start rounded-lg [&>small]:text-muted-foreground [&>small]:leading-[1.45] [&>small]:wrap-anywhere [&>span]:text-muted-foreground [&>span]:font-mono [&>span]:text-[0.6875rem] [&>span]:tracking-[0.08em] [&>span]:uppercase [&>strong]:text-[1.5rem] [&>strong]:font-semibold [&>strong]:wrap-anywhere">
            <span>Plan</span>
            <strong>{snapshot.planName ?? "Trial"}</strong>
            <small>{snapshot.planInterval ?? "Group trial"}</small>
          </div>
          <div className="p-5 gap-[0.4rem] border grid content-start rounded-lg [&>small]:text-muted-foreground [&>small]:leading-[1.45] [&>small]:wrap-anywhere [&>span]:text-muted-foreground [&>span]:font-mono [&>span]:text-[0.6875rem] [&>span]:tracking-[0.08em] [&>span]:uppercase [&>strong]:text-[1.5rem] [&>strong]:font-semibold [&>strong]:wrap-anywhere">
            <span>Subscription</span>
            <strong>{formatStatus(snapshot.subscriptionStatus)}</strong>
            <small>
              {snapshot.paymentActionRequired
                ? "Update your payment method."
                : "Nothing to pay right now."}
            </small>
          </div>
          <div className="p-5 gap-[0.4rem] border grid content-start rounded-lg [&>small]:text-muted-foreground [&>small]:leading-[1.45] [&>small]:wrap-anywhere [&>span]:text-muted-foreground [&>span]:font-mono [&>span]:text-[0.6875rem] [&>span]:tracking-[0.08em] [&>span]:uppercase [&>strong]:text-[1.5rem] [&>strong]:font-semibold [&>strong]:wrap-anywhere">
            <span>Members with access</span>
            <strong>
              {snapshot.activeEntitlementCount} / {snapshot.billableMemberCount}
            </strong>
            <small>{snapshot.expiringMemberCount} expire within 10 days</small>
          </div>
          <div className="p-5 gap-[0.4rem] border grid content-start rounded-lg [&>small]:text-muted-foreground [&>small]:leading-[1.45] [&>small]:wrap-anywhere [&>span]:text-muted-foreground [&>span]:font-mono [&>span]:text-[0.6875rem] [&>span]:tracking-[0.08em] [&>span]:uppercase [&>strong]:text-[1.5rem] [&>strong]:font-semibold [&>strong]:wrap-anywhere">
            <span>Trial ends</span>
            <strong>{formatDay(snapshot.trialEndsAt, timeZone)}</strong>
            <small>
              {snapshot.customerReference ? null : "Payment isn't set up yet."}
            </small>
          </div>
        </div>

        {snapshot.paymentActionRequired ? (
          <p role="alert">Update your payment method so members keep access.</p>
        ) : null}
        {snapshot.failedWebhookCount > 0 ? (
          <p role="alert">
            You have {snapshot.failedWebhookCount} billing update
            {snapshot.failedWebhookCount === 1 ? "" : "s"} waiting for review.
          </p>
        ) : null}
        <BillingActions hasCustomer={Boolean(snapshot.customerReference)} />

        <h2>Member access</h2>
        {billing.members.length === 0 ? (
          <p>No active members yet.</p>
        ) : (
          <div className="mt-5 border relative overflow-x-auto rounded-lg max-[720px]:[&_:is(th,td)]:block max-[720px]:[&_:is(th,td)]:min-w-0 max-[720px]:[&_:is(th,td)]:py-1! max-[720px]:[&_:is(th,td)]:px-0! max-[720px]:[&_:is(th,td)]:border-b-0! max-[720px]:[&_:is(th,td)]:w-auto! [&_table]:w-full [&_table]:min-w-192 [&_table]:border-collapse [&_table]:table-fixed [&_table]:text-left max-[720px]:[&_table]:block max-[720px]:[&_table]:w-auto! max-[720px]:[&_table]:min-w-0! max-[720px]:[&_tbody]:block max-[720px]:[&_tbody]:min-w-0 max-[720px]:[&_tbody]:w-auto! [&_tbody_th]:font-semibold [&_tbody_th]:text-[1rem]! max-[720px]:[&_tbody_tr:last-child]:border-b-0 [&_tbody_tr:last-child_td]:border-b-0 [&_tbody_tr:last-child_th]:border-b-0 max-[720px]:[&_td:last-child]:pt-3! [&_td:nth-child(1)]:w-[18%] [&_td:nth-child(2)]:w-[12%] [&_td:nth-child(3)]:w-[18%] [&_td:nth-child(4)]:w-[12%] [&_td:nth-child(5)]:w-[40%] max-[720px]:[&_td[data-label]::before]:inline-block max-[720px]:[&_td[data-label]::before]:min-w-20 max-[720px]:[&_td[data-label]::before]:text-muted-foreground max-[720px]:[&_td[data-label]::before]:[content:attr(data-label)] max-[720px]:[&_td[data-label]::before]:font-mono max-[720px]:[&_td[data-label]::before]:text-[0.6875rem] max-[720px]:[&_td[data-label]::before]:tracking-[0.08em] max-[720px]:[&_td[data-label]::before]:uppercase [&_td]:py-[0.9rem] [&_td]:px-3 [&_td]:border-b [&_td]:border-b-border/50 [&_td]:align-top [&_td]:text-[0.8125rem] [&_td]:wrap-anywhere [&_th:nth-child(1)]:w-[18%] [&_th:nth-child(2)]:w-[12%] [&_th:nth-child(3)]:w-[18%] [&_th:nth-child(4)]:w-[12%] [&_th:nth-child(5)]:w-[40%] [&_th]:py-[0.9rem] [&_th]:px-3 [&_th]:border-b [&_th]:border-b-border/50 [&_th]:align-top [&_th]:text-[0.8125rem] [&_th]:wrap-anywhere max-[720px]:[&_thead]:hidden [&_thead_th]:text-muted-foreground [&_thead_th]:font-mono [&_thead_th]:text-[0.6875rem] [&_thead_th]:tracking-[0.08em] [&_thead_th]:uppercase max-[720px]:[&_tr]:p-4 max-[720px]:[&_tr]:border-b max-[720px]:[&_tr]:border-b-border/50 max-[720px]:[&_tr]:block max-[720px]:[&_tr]:min-w-0 max-[720px]:[&_tr]:w-auto!">
            <table>
              <thead>
                <tr>
                  <th scope="col">Member</th>
                  <th scope="col">Access</th>
                  <th scope="col">Ends</th>
                  <th scope="col">Source</th>
                  <th scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {billing.members.map((member) => (
                  <tr key={member.membershipId}>
                    <th scope="row">{member.name}</th>
                    <td data-label="Access">{formatStatus(member.status)}</td>
                    <td data-label="Ends">
                      {formatInstant(member.expiresAt, timeZone)}
                    </td>
                    <td data-label="Source">{formatStatus(member.source)}</td>
                    <td>
                      <BillingEntitlementForm
                        membershipId={member.membershipId}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <h2>Invoices</h2>
        <p>Receipts appear here after your payment goes through.</p>
      </section>
    </PortalShell>
  );
}

function formatStatus(value: string) {
  return value
    .replaceAll("_", " ")
    .replace(/^./, (letter) => letter.toUpperCase());
}

// Billing dates read in the group's own time zone, like round times do.
function formatInstant(value: string | null, timeZone: string) {
  if (!value) return "—";
  return formatIn(value, timeZone, { dateStyle: "medium", timeStyle: "short" });
}

function formatDay(value: string | null, timeZone: string) {
  if (!value) return "—";
  return formatIn(value, timeZone, { dateStyle: "medium" });
}

function formatIn(
  value: string,
  timeZone: string,
  options: Intl.DateTimeFormatOptions,
) {
  try {
    return new Intl.DateTimeFormat("en-US", { ...options, timeZone }).format(
      new Date(value),
    );
  } catch {
    return new Intl.DateTimeFormat("en-US", {
      ...options,
      timeZone: "UTC",
    }).format(new Date(value));
  }
}

function BillingError() {
  return (
    <section className={portalPanelClass} aria-labelledby="billing-error-title">
      <Kicker>Billing</Kicker>
      <h1 id="billing-error-title">We couldn&apos;t load billing</h1>
      <p>Try again in a moment.</p>
      <TextLink href="/portal/billing">Try again</TextLink>
    </section>
  );
}
