"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import {
  previewRoundPublicationAction,
  publishRoundAction,
} from "@/app/actions/rounds";
import {
  ActionRow,
  FieldHelp,
  FormMessage,
  SectionHeading,
} from "@/components/blocks";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  publicationMemberName,
  type RoundPublicationMember,
  type RoundPublicationReview,
} from "@/domain/round-publication";
import type { RoundFormat } from "@/domain/round-drafts";

export function PublicationReviewPanel({
  roundId,
  initialReview,
  draftDirty,
}: Readonly<{
  roundId: string;
  initialReview: RoundPublicationReview;
  draftDirty: boolean;
}>) {
  const router = useRouter();
  const [review, setReview] = useState(initialReview);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"error" | "success" | "">("");
  const operationId = useRef<string | null>(null);
  const format = review.format;

  async function toggleExclusion(
    membershipId: string,
    excluded: boolean,
  ): Promise<void> {
    if (pending) return;
    setPending(true);
    setMessage("");
    setMessageTone("");
    const excludedMembershipIds = review.members
      .filter((member) => {
        if (member.membershipId === membershipId) return excluded;
        return (
          member.eligibilityState === "excluded" ||
          (member.eligibilityState === "eligible" && !member.included)
        );
      })
      .map((member) => member.membershipId);

    try {
      const result = await previewRoundPublicationAction({
        roundId,
        excludedMembershipIds,
      });
      if (!result.ok) {
        setMessage(result.error.message);
        setMessageTone("error");
        return;
      }
      setReview(result.data);
    } catch {
      setMessage("We couldn't check the player list. Try again.");
      setMessageTone("error");
    } finally {
      setPending(false);
    }
  }

  async function publish(): Promise<void> {
    if (pending) return;
    if (draftDirty) {
      setMessage("Save or cancel your draft changes before you publish.");
      setMessageTone("error");
      return;
    }
    const { summary } = review;
    if (summary.missingQuotaCount > 0) {
      setMessage(
        "Some players have no quota. Give them one or exclude them before you publish.",
      );
      setMessageTone("error");
      return;
    }
    if (summary.includedMemberCount === 0) {
      setMessage("Include at least one eligible member before you publish.");
      setMessageTone("error");
      return;
    }
    if (
      !window.confirm(
        `Publish this ${format === "individual_net" ? "Individual Net" : "Individual Gross"} round for ${summary.includedMemberCount} player${summary.includedMemberCount === 1 ? "" : "s"}? Players can RSVP right away, and ${summary.notificationRecipientCount} e-mail${summary.notificationRecipientCount === 1 ? "" : "s"} will be sent.`,
      )
    ) {
      return;
    }

    setPending(true);
    setMessage("");
    setMessageTone("");
    const excludedMembershipIds = review.members
      .filter(
        (member) =>
          member.eligibilityState === "excluded" ||
          (member.eligibilityState === "eligible" && !member.included),
      )
      .map((member) => member.membershipId);
    operationId.current ??= crypto.randomUUID();

    try {
      const result = await publishRoundAction({
        roundId,
        excludedMembershipIds,
        operationId: operationId.current,
        expectedRoundVersion: review.roundVersion,
        reviewFingerprint: review.reviewFingerprint,
      });
      if (!result.ok) {
        setMessage(result.error.message);
        setMessageTone("error");
        if (result.error.code === "stale_version") router.refresh();
        return;
      }
      operationId.current = null;
      setMessage(
        `Round published. ${result.data.participantCount} player${result.data.participantCount === 1 ? "" : "s"} can RSVP and ${result.data.notificationCount} e-mail${result.data.notificationCount === 1 ? "" : "s"} will be sent.`,
      );
      setMessageTone("success");
      router.refresh();
    } catch {
      setMessage("We couldn't publish the round. Try again.");
      setMessageTone("error");
    } finally {
      setPending(false);
    }
  }

  return (
    <section
      className="mt-10 pt-8 border-t [&>h2]:mx-0 [&>h2]:text-[1.5rem] [&>h2]:font-semibold [&>h2]:mt-1.5! [&>h2]:mb-0! publication-review"
      aria-labelledby="publication-review-title"
    >
      <SectionHeading
        kicker="Before you publish"
        title="Player list"
        titleId="publication-review-title"
        meta={
          format === "individual_net" ? "Individual Net" : "Individual Gross"
        }
      />
      <p>Everyone on this list is invited when you publish.</p>

      <dl
        className="mx-0 mt-6 mb-0 gap-3 grid grid-cols-6 max-[720px]:grid-cols-2 [&>div[data-warning='true']]:border-destructive [&>div[data-warning='true']_dd]:text-destructive [&>div]:p-3.5 [&>div]:border [&>div]:border-border/50 [&>div]:min-w-0 [&>div]:rounded-lg [&_dd]:mx-0 [&_dd]:mt-[0.35rem] [&_dd]:mb-0 [&_dd]:text-muted-foreground [&_dd]:text-[1.5rem] [&_dd]:wrap-anywhere [&_dt]:text-muted-foreground [&_dt]:font-mono [&_dt]:text-[0.6875rem] [&_dt]:tracking-[0.07em] [&_dt]:uppercase"
        aria-label="Player summary"
      >
        <SummaryItem
          label="Active members"
          value={review.summary.activeMemberCount}
        />
        <SummaryItem label="Included" value={review.summary.noResponseCount} />
        <SummaryItem
          label="Ineligible"
          value={review.summary.ineligibleCount}
        />
        <SummaryItem label="Excluded" value={review.summary.excludedCount} />
        <SummaryItem
          label="Missing quota"
          value={review.summary.missingQuotaCount}
          warning={review.summary.missingQuotaCount > 0}
        />
        <SummaryItem
          label="E-mails to send"
          value={review.summary.notificationRecipientCount}
        />
      </dl>

      <div className="mt-8 [&_h3]:m-0 [&_h3]:text-[1.125rem] [&_h3]:font-semibold">
        <h3>Members to review</h3>
        <ul className="mx-0 mt-6 mb-0 p-0 gap-3 grid list-none">
          {review.members.map((member) => (
            <PublicationMemberRow
              key={member.membershipId}
              member={member}
              format={format}
              disabled={pending}
              onToggle={toggleExclusion}
            />
          ))}
        </ul>
      </div>

      <FormMessage
        tone={messageTone === "success" ? "success" : "error"}
        aria-live="polite"
        data-status={messageTone || undefined}
      >
        {message}
      </FormMessage>
      <ActionRow>
        <Button
          type="button"
          onClick={() => void publish()}
          disabled={
            pending || draftDirty || review.summary.missingQuotaCount > 0
          }
        >
          {pending ? "Working…" : "Publish round"}
        </Button>
      </ActionRow>
      {draftDirty || review.summary.missingQuotaCount > 0 ? (
        <FieldHelp role="status">
          {draftDirty
            ? "Save the round details before you publish."
            : `${review.summary.missingQuotaCount} included ${review.summary.missingQuotaCount === 1 ? "player needs" : "players need"} a quota before you can publish. Set a starting quota on their member page, or exclude them.`}
        </FieldHelp>
      ) : null}
    </section>
  );
}

function PublicationMemberRow({
  member,
  format,
  disabled,
  onToggle,
}: Readonly<{
  member: RoundPublicationMember;
  format: RoundFormat;
  disabled: boolean;
  onToggle: (membershipId: string, excluded: boolean) => Promise<void>;
}>) {
  const ineligible = member.eligibilityState === "ineligible";
  const explicitlyExcluded = member.eligibilityState === "excluded";
  const missingQuota = format === "individual_net" && !member.projectionReady;
  return (
    <li className="p-4 gap-4 border border-border/50 flex items-center justify-between rounded-lg max-[720px]:items-start max-[720px]:flex-col [&_[data-slot=bound-choice]]:m-0 [&_[data-slot=bound-choice]_strong]:text-foreground max-[720px]:[&_[data-slot=row-meta]]:text-left [&_p]:mx-0 [&_p]:mb-0 [&_p]:text-muted-foreground [&_p]:mt-[0.35rem]! [&_p]:text-[0.8125rem]!">
      <div>
        <label
          className="gap-[0.4rem] flex items-center text-[0.8125rem]"
          data-slot="bound-choice"
        >
          <Checkbox
            aria-label={`Exclude ${publicationMemberName(member)}`}
            checked={
              explicitlyExcluded ||
              (member.eligibilityState === "eligible" && !member.included)
            }
            disabled={disabled}
            onCheckedChange={(checked) =>
              void onToggle(member.membershipId, checked === true)
            }
          />
          <span>Exclude</span> <strong>{publicationMemberName(member)}</strong>
        </label>
        <p>
          {ineligible
            ? `Can’t play yet: ${ineligibleReason(member.eligibilityReason)}`
            : explicitlyExcluded
              ? "Excluded"
              : member.included
                ? missingQuota
                  ? "Included · quota missing"
                  : "Included"
                : "Excluded"}
        </p>
      </div>
      <div
        className="gap-1 grid text-muted-foreground text-[0.75rem] text-right max-[720px]:text-left [&_time]:text-muted-foreground [&_time]:text-[0.6875rem]"
        data-slot="row-meta"
      >
        <span>{member.emailReady ? "Gets e-mail" : "Won't get e-mail"}</span>
        {member.projectedQuota ? (
          <span>Quota {member.projectedQuota}</span>
        ) : null}
      </div>
    </li>
  );
}

function SummaryItem({
  label,
  value,
  warning = false,
}: Readonly<{ label: string; value: number; warning?: boolean }>) {
  return (
    <div data-warning={warning || undefined}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function ineligibleReason(reason: string | null | undefined) {
  switch (reason) {
    case "profile_missing":
      return "their profile isn’t filled in";
    case "identity_not_eligible":
      return "they haven’t confirmed their account e-mail";
    case "format_required":
      return "choose a format for this round first";
    case "quota_not_ready":
      return "they have no quota. Set a starting quota on their member page";
    default:
      return "ask support for help";
  }
}
