import { redirect } from "next/navigation";
import { z } from "zod";

import { FormMessage, Kicker, TextLink } from "@/components/blocks";
import { createServerComponentSupabaseClient } from "@/lib/supabase/server-component-client";

import { requirePortalPageContext } from "../portal-page-context";
import { PortalShell } from "../portal-shell";
import {
  QuotaSettingsForm,
  type QuotaSettingsFormValue,
} from "../quota-settings-form";

const quotaSettingsSchema = z.object({
  method: z.enum(["moving_average", "best_10_of_20", "previous_plus_minus"]),
  moving_average_history_length: z.number().int().min(4).max(20).nullable(),
  participation_merit: z.union([z.string(), z.number()]),
  precision: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  standings_reset_date: z.string().nullable(),
  version: z.number().int().positive(),
});

const quotaBandsSchema = z.array(
  z.object({
    adjustment: z.union([z.string(), z.number()]),
    lower_bound: z.union([z.string(), z.number()]),
    lower_inclusive: z.boolean(),
    upper_bound: z.union([z.string(), z.number()]),
    upper_inclusive: z.boolean(),
  }),
);

const placementMeritRowsSchema = z.array(
  z.object({
    merit_points: z.union([z.string(), z.number()]),
    rank: z.number().int().positive(),
  }),
);

export default async function QuotaRulesPage() {
  const context = await requirePortalPageContext("/portal/quota");
  if (context.role !== "administrator") redirect("/portal");
  const supabase = await createServerComponentSupabaseClient();

  let quotaSettings: QuotaSettingsFormValue | null = null;
  let quotaSettingsUnavailable = false;

  {
    const [settingsResult, bandsResult, placementResult] = await Promise.all([
      supabase
        .from("group_quota_settings")
        .select(
          "method,moving_average_history_length,precision,version,participation_merit,standings_reset_date",
        )
        .eq("group_id", context.groupId)
        .maybeSingle(),
      supabase
        .from("quota_adjustment_bands")
        .select(
          "lower_bound,lower_inclusive,upper_bound,upper_inclusive,adjustment",
        )
        .eq("group_id", context.groupId)
        .order("position"),
      supabase
        .from("placement_merit_rows")
        .select("rank,merit_points")
        .eq("group_id", context.groupId)
        .order("rank"),
    ]);
    const parsedSettings = quotaSettingsSchema
      .nullable()
      .safeParse(settingsResult.data);
    const parsedBands = quotaBandsSchema.safeParse(bandsResult.data);
    const parsedPlacement = placementMeritRowsSchema.safeParse(
      placementResult.data,
    );

    quotaSettingsUnavailable = Boolean(
      settingsResult.error ||
      bandsResult.error ||
      placementResult.error ||
      !parsedSettings.success ||
      !parsedBands.success ||
      !parsedPlacement.success,
    );

    if (!quotaSettingsUnavailable && parsedSettings.data) {
      quotaSettings = {
        bands: parsedBands.success
          ? parsedBands.data.map((band) => ({
              adjustment: String(band.adjustment),
              lowerBound: String(band.lower_bound),
              lowerInclusive: band.lower_inclusive,
              upperBound: String(band.upper_bound),
              upperInclusive: band.upper_inclusive,
            }))
          : [],
        historyLength: parsedSettings.data.moving_average_history_length,
        method: parsedSettings.data.method,
        precision: parsedSettings.data.precision,
        participationMerit: String(parsedSettings.data.participation_merit),
        placementMerit: parsedPlacement.success
          ? parsedPlacement.data.map((placement) => ({
              rank: placement.rank,
              points: String(placement.merit_points),
            }))
          : [],
        standingsResetDate: parsedSettings.data.standings_reset_date,
        version: parsedSettings.data.version,
      };
    }
  }

  return (
    <PortalShell
      email={context.email}
      groupName={context.groupName}
      role={context.role}
      timeZone={context.timeZone}
      currentSection="quota"
    >
      <section
        className="mx-auto mt-6 mb-0 p-[clamp(1.5rem,4vw,3rem)] border max-w-288 bg-card max-[480px]:m-0 max-[480px]:border-0 max-[480px]:min-h-[calc(100vh_-_10rem)] [&>h2+p]:m-0 [&>h2+p]:text-muted-foreground [&>h2+p]:leading-[1.55] [&>h2]:mx-0 [&>h2]:mb-3 [&>h2]:pt-8 [&>h2]:border-t [&>h2]:text-[1.5rem] [&>h2]:font-semibold [&>h2]:mt-12! [&>p:not([data-slot=kicker])]:max-w-168 [&>p:not([data-slot=kicker])]:text-muted-foreground [&>p:not([data-slot=kicker])]:leading-[1.65] [&>p[role='alert']]:mx-0 [&>p[role='alert']]:mt-6 [&>p[role='alert']]:mb-0 [&>p[role='alert']]:p-4 [&>p[role='alert']]:border-l-[0.25rem] [&>p[role='alert']]:border-l-destructive [&>p[role='alert']]:bg-border [&>p[role='alert']]:text-foreground! [&>p[role='alert']]:leading-[1.5]! [&_form:where([data-slot=form-stack],[data-slot=quota-settings-form])]:max-w-184 [&_h1]:mx-0 [&_h1]:mt-2.5 [&_h1]:mb-4 [&_h1]:text-[length:clamp(1.75rem,3vw,2.5rem)] [&_h1]:font-semibold [&_h1]:tracking-[-0.02em] [&_h1]:leading-[1.1]"
        aria-labelledby="quota-settings-title"
      >
        <Kicker>Settings</Kicker>
        <h1 id="quota-settings-title">Quota rules</h1>
        <p>
          New rules apply to rounds you publish from now on. Rounds you&apos;ve
          already published keep their rules. A new standings reset date takes
          effect right away: it changes which results count toward standings.
        </p>
        {quotaSettingsUnavailable ? (
          <div className="quota-settings-error">
            <FormMessage data-status="error">
              We couldn&apos;t load your quota rules. Refresh the page before
              you make changes.
            </FormMessage>
            <TextLink href="/portal/quota">Reload quota rules</TextLink>
          </div>
        ) : (
          <QuotaSettingsForm
            key={quotaSettings?.version ?? 0}
            identityKey={context.groupId}
            initialValue={quotaSettings}
          />
        )}
      </section>
    </PortalShell>
  );
}
