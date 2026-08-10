"use server";

import { headers } from "next/headers";
import { z } from "zod";

import { verifyMutationSession } from "@/lib/auth/verify-mutation-session";
import { MutationError, mutationFailure } from "@/lib/mutations/result";
import {
  beginBillingCheckout,
  executeReadBillingPortal,
  finishBillingCheckout,
  resolveBillingAdminContext,
} from "@/lib/billing/billing-data";
import {
  createStripeCheckoutSession,
  createStripeCustomerPortalSession,
} from "@/lib/billing/stripe-api";
import { webRuntimeEnv } from "@/lib/runtime-env";
import { createSupabaseServiceClient } from "@/lib/supabase/service-client";

const operationSchema = z.object({ operationId: z.uuid() }).strict();
const entitlementSchema = operationSchema
  .extend({
    membershipId: z.uuid(),
    expiresAt: z.coerce.date(),
    reason: z.string().trim().min(1).max(1000),
  })
  .strict();

type ActionResult =
  | Readonly<{
      ok: true;
      data: Readonly<Record<string, unknown>>;
      correlationId: string;
    }>
  | ReturnType<typeof mutationFailure>;

export async function startBillingCheckoutAction(
  input: unknown,
): Promise<ActionResult> {
  const correlationId =
    (await headers()).get("x-correlation-id") ?? crypto.randomUUID();
  const parsed = operationSchema.safeParse(input);
  if (!parsed.success)
    return mutationFailure(new MutationError("validation"), correlationId);
  try {
    const session = await verifyMutationSession();
    const admin = await resolveBillingAdminContext(session.userId);
    const portal = await executeReadBillingPortal(session.userId);
    const checkout = await beginBillingCheckout({
      groupId: admin.groupId,
      actorUserId: session.userId,
      operationId: parsed.data.operationId,
      kind: "checkout",
    });
    if (checkout.stripeSessionUrl || checkout.state !== "processing") {
      return {
        ok: true,
        data: {
          state: checkout.state,
          checkoutUrl: checkout.stripeSessionUrl,
          processing: checkout.state === "processing",
        },
        correlationId,
      };
    }
    let stripeSession;
    try {
      stripeSession = await createStripeCheckoutSession({
        customerId: admin.customerId,
        customerEmail: admin.email,
        groupId: admin.groupId,
        quantity: Math.max(portal.snapshot.billableMemberCount, 1),
        successUrl: `${webRuntimeEnv.appUrl}/portal/billing?billing=processing`,
        cancelUrl: `${webRuntimeEnv.appUrl}/portal/billing?billing=cancelled`,
      });
    } catch (error) {
      await finishBillingCheckout({
        id: checkout.id,
        state: "failed",
        safeError:
          error instanceof Error ? error.message : "Stripe checkout failed",
      });
      throw error;
    }
    await finishBillingCheckout({
      id: checkout.id,
      stripeSessionId: stripeSession.id,
      stripeSessionUrl: stripeSession.url,
      state: "succeeded",
    });
    return {
      ok: true,
      data: {
        state: "succeeded",
        checkoutUrl: stripeSession.url ?? null,
        processing: true,
      },
      correlationId,
    };
  } catch (error) {
    return mutationFailure(error, correlationId);
  }
}

export async function openBillingPortalAction(
  input: unknown,
): Promise<ActionResult> {
  const correlationId =
    (await headers()).get("x-correlation-id") ?? crypto.randomUUID();
  const parsed = operationSchema.safeParse(input);
  if (!parsed.success)
    return mutationFailure(new MutationError("validation"), correlationId);
  try {
    const session = await verifyMutationSession();
    const admin = await resolveBillingAdminContext(session.userId);
    if (!admin.customerId) {
      throw new MutationError("locked");
    }
    const checkout = await beginBillingCheckout({
      groupId: admin.groupId,
      actorUserId: session.userId,
      operationId: parsed.data.operationId,
      kind: "portal",
    });
    if (checkout.stripeSessionUrl || checkout.state !== "processing") {
      return {
        ok: true,
        data: {
          state: checkout.state,
          portalUrl: checkout.stripeSessionUrl,
          processing: false,
        },
        correlationId,
      };
    }
    let stripeSession;
    try {
      stripeSession = await createStripeCustomerPortalSession({
        customerId: admin.customerId,
        returnUrl: `${webRuntimeEnv.appUrl}/portal/billing`,
      });
    } catch (error) {
      await finishBillingCheckout({
        id: checkout.id,
        state: "failed",
        safeError:
          error instanceof Error ? error.message : "Stripe portal failed",
      });
      throw error;
    }
    await finishBillingCheckout({
      id: checkout.id,
      stripeSessionId: stripeSession.id,
      stripeSessionUrl: stripeSession.url,
      state: "succeeded",
    });
    return {
      ok: true,
      data: {
        state: "succeeded",
        portalUrl: stripeSession.url ?? null,
        processing: false,
      },
      correlationId,
    };
  } catch (error) {
    return mutationFailure(error, correlationId);
  }
}

export async function grantBillingEntitlementAction(
  input: unknown,
): Promise<ActionResult> {
  const correlationId =
    (await headers()).get("x-correlation-id") ?? crypto.randomUUID();
  const parsed = entitlementSchema.safeParse(input);
  if (!parsed.success)
    return mutationFailure(new MutationError("validation"), correlationId);
  try {
    const session = await verifyMutationSession();
    const admin = await resolveBillingAdminContext(session.userId);
    const service = createSupabaseServiceClient();
    const result = await service.rpc("grant_billing_entitlement", {
      p_actor_user_id: session.userId,
      p_membership_id: parsed.data.membershipId,
      p_expires_at: parsed.data.expiresAt.toISOString(),
      p_reason: parsed.data.reason,
      p_correlation_id: correlationId,
      p_operation_id: parsed.data.operationId,
    });
    if (result.error) throw result.error;
    return {
      ok: true,
      data: { groupId: admin.groupId, entitlement: result.data?.[0] ?? null },
      correlationId,
    };
  } catch (error) {
    return mutationFailure(error, correlationId);
  }
}
