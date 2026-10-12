import "server-only";

import { z } from "zod";

import { createServerComponentSupabaseClient } from "@/lib/supabase/server-component-client";
import { createSupabaseServiceClient } from "@/lib/supabase/service-client";

const billingSnapshotSchema = z.object({
  group_id: z.uuid(),
  stripe_customer_reference: z.string().nullable(),
  stripe_subscription_reference: z.string().nullable(),
  plan_name: z.string().nullable(),
  plan_interval: z.string().nullable(),
  plan_amount_minor: z.number().int().nullable(),
  plan_currency: z.string().nullable(),
  subscription_status: z.enum([
    "trialing",
    "active",
    "past_due",
    "canceled",
    "unpaid",
    "incomplete",
    "incomplete_expired",
    "paused",
    "expired",
  ]),
  trial_started_at: z.string().nullable(),
  trial_ends_at: z.string().nullable(),
  current_period_start: z.string().nullable(),
  current_period_end: z.string().nullable(),
  next_invoice_at: z.string().nullable(),
  payment_action_required: z.boolean(),
  active_entitlement_count: z.number().int().nonnegative(),
  billable_member_count: z.number().int().nonnegative(),
  expired_member_count: z.number().int().nonnegative(),
  expiring_member_count: z.number().int().nonnegative(),
  failed_webhook_count: z.number().int().nonnegative(),
  last_webhook_at: z.string().nullable(),
});

const entitlementSchema = z.object({
  membership_id: z.uuid(),
  first_name: z.string().nullable(),
  last_name: z.string().nullable(),
  status: z.enum(["active", "grace", "expired", "revoked"]),
  starts_at: z.string().nullable(),
  expires_at: z.string().nullable(),
  source: z.string(),
  reason: z.string().nullable(),
});

export type BillingSnapshot = Readonly<{
  groupId: string;
  customerReference: string | null;
  subscriptionReference: string | null;
  planName: string | null;
  planInterval: string | null;
  planAmountMinor: number | null;
  planCurrency: string | null;
  subscriptionStatus: z.infer<
    typeof billingSnapshotSchema
  >["subscription_status"];
  trialStartedAt: string | null;
  trialEndsAt: string | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  nextInvoiceAt: string | null;
  paymentActionRequired: boolean;
  activeEntitlementCount: number;
  billableMemberCount: number;
  expiredMemberCount: number;
  expiringMemberCount: number;
  failedWebhookCount: number;
  lastWebhookAt: string | null;
}>;

export type BillingMemberEntitlement = Readonly<{
  membershipId: string;
  name: string;
  status: z.infer<typeof entitlementSchema>["status"];
  startsAt: string | null;
  expiresAt: string | null;
  source: string;
  reason: string | null;
}>;

export async function executeReadBillingPortal(userId: string): Promise<{
  snapshot: BillingSnapshot;
  members: readonly BillingMemberEntitlement[];
}> {
  const client = await createServerComponentSupabaseClient();
  const [snapshotResult, membersResult] = await Promise.all([
    client.rpc("read_billing_portal", { p_actor_user_id: userId }),
    client.rpc("read_billing_member_entitlements", { p_actor_user_id: userId }),
  ]);
  if (snapshotResult.error || membersResult.error) {
    throw snapshotResult.error ?? membersResult.error;
  }
  const parsedSnapshot = z
    .array(billingSnapshotSchema)
    .length(1)
    .safeParse(snapshotResult.data);
  const parsedMembers = z
    .array(entitlementSchema)
    .safeParse(membersResult.data);
  if (!parsedSnapshot.success || !parsedMembers.success) {
    throw new Error("Invalid billing portal response");
  }
  const row = parsedSnapshot.data[0];
  return {
    snapshot: {
      groupId: row.group_id,
      customerReference: row.stripe_customer_reference,
      subscriptionReference: row.stripe_subscription_reference,
      planName: row.plan_name,
      planInterval: row.plan_interval,
      planAmountMinor: row.plan_amount_minor,
      planCurrency: row.plan_currency,
      subscriptionStatus: row.subscription_status,
      trialStartedAt: row.trial_started_at,
      trialEndsAt: row.trial_ends_at,
      currentPeriodStart: row.current_period_start,
      currentPeriodEnd: row.current_period_end,
      nextInvoiceAt: row.next_invoice_at,
      paymentActionRequired: row.payment_action_required,
      activeEntitlementCount: row.active_entitlement_count,
      billableMemberCount: row.billable_member_count,
      expiredMemberCount: row.expired_member_count,
      expiringMemberCount: row.expiring_member_count,
      failedWebhookCount: row.failed_webhook_count,
      lastWebhookAt: row.last_webhook_at,
    },
    members: parsedMembers.data.map((member) => ({
      membershipId: member.membership_id,
      name:
        [member.first_name, member.last_name].filter(Boolean).join(" ") ||
        "Unnamed member",
      status: member.status,
      startsAt: member.starts_at,
      expiresAt: member.expires_at,
      source: member.source,
      reason: member.reason,
    })),
  };
}

export async function resolveBillingAdminContext(userId: string): Promise<{
  groupId: string;
  email: string | null;
  customerId: string | null;
}> {
  const client = await createServerComponentSupabaseClient();
  const contextResult = await client.rpc("resolve_identity_context");
  const context = z
    .array(
      z.object({
        group_id: z.uuid(),
        role: z.enum(["member", "coordinator", "administrator"]),
      }),
    )
    .safeParse(contextResult.data);
  const actor = context.success ? context.data[0] : undefined;
  if (contextResult.error || actor?.role !== "administrator") {
    throw new Error("billing_admin_required");
  }
  const service = createSupabaseServiceClient();
  const [accountResult, userResult] = await Promise.all([
    service
      .from("billing_accounts")
      .select("stripe_customer_id")
      .eq("group_id", actor.group_id)
      .maybeSingle(),
    service.auth.admin.getUserById(userId),
  ]);
  if (accountResult.error) throw accountResult.error;
  return {
    groupId: actor.group_id,
    email: userResult.data.user?.email ?? null,
    customerId:
      (accountResult.data as { stripe_customer_id?: string | null } | null)
        ?.stripe_customer_id ?? null,
  };
}

const checkoutSessionColumns = "id,state,stripe_session_id,stripe_session_url";

function checkoutSessionFromRow(row: {
  id: string;
  state: "processing" | "succeeded" | "failed";
  stripe_session_id: string | null;
  stripe_session_url: string | null;
}) {
  return {
    id: row.id,
    state: row.state,
    stripeSessionId: row.stripe_session_id,
    stripeSessionUrl: row.stripe_session_url,
  };
}

export async function beginBillingCheckout(input: {
  groupId: string;
  actorUserId: string;
  operationId: string;
  kind: "checkout" | "portal";
}): Promise<{
  id: string;
  state: "processing" | "succeeded" | "failed";
  stripeSessionId: string | null;
  stripeSessionUrl: string | null;
}> {
  const service = createSupabaseServiceClient();
  const result = await service
    .from("billing_checkout_sessions")
    .insert({
      group_id: input.groupId,
      actor_user_id: input.actorUserId,
      operation_id: input.operationId,
      kind: input.kind,
    })
    .select(checkoutSessionColumns)
    .single();
  if (!result.error) return checkoutSessionFromRow(result.data);
  if (result.error.code !== "23505") throw result.error;
  const existing = await service
    .from("billing_checkout_sessions")
    .select(checkoutSessionColumns)
    .eq("actor_user_id", input.actorUserId)
    .eq("operation_id", input.operationId)
    .single();
  if (existing.error) throw existing.error;
  return checkoutSessionFromRow(existing.data);
}

export async function finishBillingCheckout(input: {
  id: string;
  stripeSessionId?: string | null;
  stripeSessionUrl?: string | null;
  state: "succeeded" | "failed";
  safeError?: string | null;
}) {
  const service = createSupabaseServiceClient();
  const result = await service
    .from("billing_checkout_sessions")
    .update({
      stripe_session_id: input.stripeSessionId ?? null,
      stripe_session_url: input.stripeSessionUrl ?? null,
      state: input.state,
      safe_error: input.safeError?.slice(0, 2000) ?? null,
      completed_at: new Date().toISOString(),
    })
    .eq("id", input.id);
  if (result.error) throw result.error;
}
