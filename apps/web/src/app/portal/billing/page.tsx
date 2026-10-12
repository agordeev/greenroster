import Link from "next/link";
import { redirect } from "next/navigation";
import { z } from "zod";

import { executeReadBillingPortal } from "@/lib/billing/billing-data";
import { verifyMutationSession } from "@/lib/auth/verify-mutation-session";
import { createServerComponentSupabaseClient } from "@/lib/supabase/server-component-client";
import { PortalShell } from "../portal-shell";
import { BillingActions } from "./billing-actions";
import { BillingEntitlementForm } from "./entitlement-form";

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
          className="portal-ledger role-denied"
          aria-labelledby="billing-denied-title"
        >
          <p className="ledger-kicker">Billing</p>
          <h1 id="billing-denied-title">You cannot manage billing</h1>
          <p>Your administrator can manage the plan and member access.</p>
          <Link className="secondary-link" href="/portal">
            Return to portal home
          </Link>
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
  return (
    <PortalShell
      email={userResult.data.user.email ?? ""}
      groupName={groupResult.data.name}
      role="administrator"
      timeZone={groupResult.data.time_zone}
      currentSection="billing"
    >
      <section className="portal-ledger" aria-labelledby="billing-title">
        <p className="ledger-kicker">Billing</p>
        <h1 id="billing-title">Billing</h1>
        <p>See your trial, payment status, member access, and invoices.</p>

        <div className="portal-card-grid">
          <div className="portal-card">
            <span>Plan</span>
            <strong>{snapshot.planName ?? "Trial"}</strong>
            <small>{snapshot.planInterval ?? "Group trial"}</small>
          </div>
          <div className="portal-card">
            <span>Subscription</span>
            <strong>{formatStatus(snapshot.subscriptionStatus)}</strong>
            <small>
              {snapshot.paymentActionRequired
                ? "You need to update payment."
                : "You have no payment action."}
            </small>
          </div>
          <div className="portal-card">
            <span>Members with access</span>
            <strong>
              {snapshot.activeEntitlementCount} / {snapshot.billableMemberCount}
            </strong>
            <small>{snapshot.expiringMemberCount} expire within 10 days</small>
          </div>
          <div className="portal-card">
            <span>Trial ends</span>
            <strong>{formatInstant(snapshot.trialEndsAt)}</strong>
            <small>
              {snapshot.customerReference
                ? `Customer ${snapshot.customerReference}`
                : "You have not connected Stripe yet."}
            </small>
          </div>
        </div>

        {snapshot.paymentActionRequired ? (
          <p role="alert">
            You need to update your payment method before members keep access.
          </p>
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
          <p>You have no active members yet.</p>
        ) : (
          <div className="portal-table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Member</th>
                  <th scope="col">Access</th>
                  <th scope="col">Ends</th>
                  <th scope="col">Source</th>
                  <th scope="col">
                    <span className="visually-hidden">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {billing.members.map((member) => (
                  <tr key={member.membershipId}>
                    <th scope="row">{member.name}</th>
                    <td>{formatStatus(member.status)}</td>
                    <td>{formatInstant(member.expiresAt)}</td>
                    <td>{member.source}</td>
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
        <p>
          After Stripe sends your payment update, you can open receipts from
          this page.
        </p>
      </section>
    </PortalShell>
  );
}

function formatStatus(value: string) {
  return value
    .replaceAll("_", " ")
    .replace(/^./, (letter) => letter.toUpperCase());
}

function formatInstant(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(value));
}

function BillingError() {
  return (
    <section className="portal-ledger" aria-labelledby="billing-error-title">
      <p className="ledger-kicker">Billing</p>
      <h1 id="billing-error-title">You cannot load billing right now</h1>
      <p>Try again in a moment.</p>
      <Link className="secondary-link" href="/portal/billing">
        Try again
      </Link>
    </section>
  );
}
