import type { ReactNode } from "react";
import { cn } from "cn";
import { ChevronRightIcon } from "lucide-react";
import Link from "next/link";

import { FormMessage, TextLink } from "@/components/blocks";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { PortalDashboardSummary } from "@/domain/portal-dashboard";

// The organizer's home view: members first, then the latest round and the
// Order of Merit, then notification delivery.
export function PortalDashboard({
  summary,
  timeZone,
  unavailable,
}: Readonly<{
  summary: PortalDashboardSummary | null;
  timeZone: string;
  unavailable: boolean;
}>) {
  if (unavailable) {
    return (
      <FormMessage>
        We couldn&apos;t load your member and invitation counts. Refresh to try
        again.
      </FormMessage>
    );
  }
  if (!summary) return null;

  const invitations = summary.actionRequiredInvitations;
  const health = summary.notificationHealth;
  const result = summary.completedResult;
  const standings = summary.standingsSummary;

  return (
    <div className="grid animate-in gap-4 duration-500 fade-in slide-in-from-bottom-2">
      <Card
        className="gap-0 py-0"
        role="region"
        aria-labelledby="dashboard-members-title"
      >
        <CardHeader className="border-b pt-4">
          <CardTitle>
            <h2 id="dashboard-members-title">Members</h2>
          </CardTitle>
          <CardAction>
            <TextLink href="/portal/members">See members</TextLink>
          </CardAction>
        </CardHeader>
        <StatStrip className="grid-cols-3">
          <Stat
            href="/portal/members?status=pending"
            aria-label={`Review ${summary.membershipCounts.pending} pending members`}
            label="Pending members"
            value={summary.membershipCounts.pending}
          />
          <Stat
            href="/portal/members?status=active"
            aria-label={`Review ${summary.membershipCounts.active} active members`}
            label="Active members"
            value={summary.membershipCounts.active}
          />
          <Stat
            href="/portal/members?status=inactive"
            aria-label={`Review ${summary.membershipCounts.inactive} inactive members`}
            label="Inactive members"
            value={summary.membershipCounts.inactive}
          />
        </StatStrip>
        <Link
          className={cn(
            insetLinkClass,
            "flex items-center gap-4 border-t px-4 py-3",
          )}
          href="/portal/invitations?delivery=action-required"
          aria-label={`Review ${invitations.total} invitations with delivery problems`}
        >
          <span className="grid min-w-0 flex-1 gap-0.5">
            <span className="font-medium">
              {invitations.total === 0
                ? "Invitations"
                : "Invitations need attention"}
            </span>
            <span className="text-muted-foreground">
              {invitations.total === 0
                ? "No invitations failed to deliver"
                : formatActionRequiredInvitationSummary(invitations)}
            </span>
          </span>
          <span
            className={cn(
              "font-mono text-xl font-medium tabular-nums",
              invitations.total === 0 && "text-muted-foreground",
            )}
          >
            {invitations.total}
          </span>
          <ChevronRightIcon
            className="size-4 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
        </Link>
      </Card>

      {result !== undefined || standings ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <HeadlineCard
            href={
              result
                ? `/portal/rounds?round=${encodeURIComponent(result.roundId)}`
                : "/portal/rounds"
            }
            aria-label="Open recent round results"
            label="Latest completed round"
            headline={
              result
                ? result.description || "Completed round"
                : "No completed rounds"
            }
            detail={
              result
                ? result.winnerNames.length > 0
                  ? result.winnerNames.join(" · ")
                  : "No ranked winner"
                : undefined
            }
            note={
              result
                ? `${result.resultCount} results · ${formatDashboardDate(result.completedAt, result.groupTimeZone)}`
                : "Go to rounds"
            }
          />
          {standings ? (
            <HeadlineCard
              href="/portal/standings"
              aria-label="Open current Order of Merit standings"
              label="Current Order of Merit"
              headline={standings.leader?.name ?? "No ranked members"}
              detail={
                standings.leader
                  ? `${standings.leader.meritTotal ?? "0"} merit`
                  : undefined
              }
              note={
                standings.leader
                  ? `${standings.memberCount} active members`
                  : `${standings.memberCount} active members · Complete a round to rank members`
              }
            />
          ) : null}
        </div>
      ) : null}

      {health ? (
        <Card
          className="gap-0 py-0"
          role="region"
          aria-labelledby="dashboard-notification-health-title"
        >
          <CardHeader className="border-b pt-4">
            <CardTitle>
              <h2 id="dashboard-notification-health-title">Notifications</h2>
            </CardTitle>
          </CardHeader>
          <StatStrip className="grid-cols-2 sm:grid-cols-4">
            <Stat
              label="Waiting to send"
              value={health.queueDepth}
              note={
                health.oldestQueuedAt
                  ? `Waiting since ${formatHealthTimestamp(health.oldestQueuedAt, timeZone)}`
                  : "Nothing waiting"
              }
            />
            <Stat
              label="E-mails not delivered"
              value={health.emailFailures}
              note={`${formatHealthRate(health.emailBounceRate)} bounced · ${formatHealthRate(health.emailComplaintRate)} marked as spam`}
            />
            <Stat
              label="Push not delivered"
              value={health.pushFailures}
              note={`${formatHealthRate(health.pushInvalidTokenRate)} of phones no longer reachable`}
            />
            <Stat label="Confirmations failed" value={health.receiptFailures} />
          </StatStrip>
        </Card>
      ) : null}
    </div>
  );
}

// Links that sit inside a card draw their focus ring inward, because the card
// clips anything outside its edge.
const insetLinkClass =
  "text-inherit no-underline outline-none transition-colors hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring focus-visible:ring-inset";

// A row of numbers on one card, split by hairlines instead of separate boxes.
function StatStrip({
  className,
  children,
}: Readonly<{ className?: string; children: ReactNode }>) {
  return (
    <div className={cn("grid gap-px bg-border", className)}>{children}</div>
  );
}

// One number in a strip. With `href` the whole cell is a link. A zero is
// dimmed so the numbers that need a look stand out.
function Stat({
  label,
  value,
  note,
  href,
  "aria-label": ariaLabel,
}: Readonly<{
  label: string;
  value: number;
  note?: ReactNode;
  href?: string;
  "aria-label"?: string;
}>) {
  const content = (
    <>
      <span className="text-muted-foreground">{label}</span>
      <span
        className={cn(
          "font-mono text-3xl leading-none font-medium tracking-tight tabular-nums",
          value === 0 && "text-muted-foreground",
        )}
      >
        {value}
      </span>
      {note ? (
        <span className="text-xs leading-normal text-muted-foreground">
          {note}
        </span>
      ) : null}
    </>
  );
  const cellClass = "grid content-start gap-2 bg-card p-4";

  return href ? (
    <Link
      className={cn(cellClass, insetLinkClass, "hover:bg-muted")}
      href={href}
      aria-label={ariaLabel}
    >
      {content}
    </Link>
  ) : (
    <div className={cellClass}>{content}</div>
  );
}

// A card that leads with a name instead of a number: the latest round, the
// Order of Merit leader. The whole card is a link.
function HeadlineCard({
  label,
  headline,
  detail,
  note,
  href,
  "aria-label": ariaLabel,
}: Readonly<{
  label: string;
  headline: string;
  detail?: string | undefined;
  note: string;
  href: string;
  "aria-label": string;
}>) {
  return (
    <Link
      className="group/card-link block rounded-xl text-inherit no-underline outline-none focus-visible:ring-3 focus-visible:ring-ring"
      href={href}
      aria-label={ariaLabel}
    >
      <Card className="h-full transition-colors group-hover/card-link:bg-muted/50">
        <CardHeader>
          <CardDescription>{label}</CardDescription>
          <CardTitle className="text-xl font-semibold text-balance">
            {headline}
          </CardTitle>
          <CardAction>
            <ChevronRightIcon
              className="size-4 text-muted-foreground"
              aria-hidden="true"
            />
          </CardAction>
        </CardHeader>
        <CardContent className="mt-auto grid gap-1">
          {detail ? <span className="font-medium">{detail}</span> : null}
          <span className="text-xs text-muted-foreground">{note}</span>
        </CardContent>
      </Card>
    </Link>
  );
}

function formatDashboardDate(value: string | null, timeZone: string) {
  if (!value) return "date unavailable";
  try {
    return new Intl.DateTimeFormat("en-US", {
      dateStyle: "medium",
      timeZone,
    }).format(new Date(value));
  } catch {
    return "date unavailable";
  }
}

function formatHealthTimestamp(value: string, timeZone: string) {
  try {
    return new Intl.DateTimeFormat("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: timeZone || "UTC",
    }).format(new Date(value));
  } catch {
    return "time unavailable";
  }
}

function formatHealthRate(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

function formatActionRequiredInvitationSummary(
  summary: PortalDashboardSummary["actionRequiredInvitations"],
) {
  const labels = [
    summary.failedPermanent > 0
      ? `${summary.failedPermanent} failed to deliver`
      : null,
    summary.suppressed > 0 ? `${summary.suppressed} not sent` : null,
    summary.addressSuppression > 0
      ? `${summary.addressSuppression} blocked from sending`
      : null,
  ];
  return labels.filter((label): label is string => label !== null).join(" · ");
}
