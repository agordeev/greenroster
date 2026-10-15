"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import {
  previewRoundPublicationAction,
  publishRoundAction,
} from "@/app/actions/rounds";
import { FieldHelp, FormMessage, SectionHeading } from "@/components/blocks";
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
      setMessage("Save your changes before you publish.");
      setMessageTone("error");
      return;
    }
    if (summary.missingQuotaCount > 0) {
      setMessage(
        "Some players have no quota. Give them one or leave them out before you publish.",
      );
      setMessageTone("error");
      return;
    }
    if (summary.includedMemberCount === 0) {
      setMessage("Invite at least one player before you publish.");
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

  const { summary } = review;
  const blocker = draftDirty
    ? "Save your changes before you publish."
    : summary.missingQuotaCount > 0
      ? `${summary.missingQuotaCount} invited ${summary.missingQuotaCount === 1 ? "player needs" : "players need"} a quota before you can publish. Set a starting quota on their member page, or leave them out.`
      : summary.includedMemberCount === 0
        ? "Invite at least one player before you publish."
        : null;

  return (
    <>
      <section
        className="border-t pt-8"
        aria-labelledby="publication-review-title"
      >
        <SectionHeading
          title="Player list"
          titleId="publication-review-title"
          meta={`${summary.activeMemberCount} ${summary.activeMemberCount === 1 ? "member" : "members"}`}
        />
        <p className="mx-0 mt-2 mb-0 text-sm leading-[1.55] text-muted-foreground">
          Tick the members you want to invite. They can RSVP as soon as you
          publish.
        </p>
        <ul className="mx-0 mt-5 mb-0 list-none divide-y border-y p-0">
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
      </section>

      <aside
        className="grid gap-4 rounded-lg border p-5 min-[880px]:sticky min-[880px]:top-6 min-[880px]:col-start-2 min-[880px]:row-span-2 min-[880px]:row-start-1"
        aria-labelledby="publish-round-title"
      >
        <h2 id="publish-round-title" className="m-0 text-xl">
          Publish
        </h2>
        <dl className="m-0 divide-y border-y text-sm">
          <SummaryItem label="Invited" value={summary.includedMemberCount} />
          {summary.missingQuotaCount > 0 ? (
            <SummaryItem
              label="Need a quota"
              value={summary.missingQuotaCount}
              warning
            />
          ) : null}
          {summary.ineligibleCount > 0 ? (
            <SummaryItem
              label="Can’t play yet"
              value={summary.ineligibleCount}
            />
          ) : null}
          {summary.excludedCount > 0 ? (
            <SummaryItem label="Left out" value={summary.excludedCount} />
          ) : null}
          <SummaryItem
            label="E-mails to send"
            value={summary.notificationRecipientCount}
          />
        </dl>
        <FormMessage
          tone={messageTone === "success" ? "success" : "error"}
          aria-live="polite"
          data-status={messageTone || undefined}
        >
          {message}
        </FormMessage>
        <Button
          type="button"
          className="w-full justify-self-stretch"
          onClick={() => void publish()}
          disabled={pending || blocker !== null}
        >
          {pending ? "Working…" : "Publish round"}
        </Button>
        {blocker ? <FieldHelp role="status">{blocker}</FieldHelp> : null}
      </aside>
    </>
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
  const invited = member.eligibilityState === "eligible" && member.included;
  const missingQuota =
    invited && format === "individual_net" && !member.projectionReady;
  const name = publicationMemberName(member);
  return (
    <li className="flex items-start justify-between gap-4 py-2 max-[480px]:flex-col max-[480px]:gap-1">
      <div className="min-w-0">
        <label
          className="flex min-h-11 items-center gap-3 text-[0.9375rem] font-semibold"
          data-slot="bound-choice"
        >
          <Checkbox
            aria-label={`Invite ${name}`}
            checked={invited}
            disabled={disabled || ineligible}
            onCheckedChange={(checked) =>
              void onToggle(member.membershipId, checked !== true)
            }
          />
          <span
            className={
              invited ? "wrap-anywhere" : "wrap-anywhere text-muted-foreground"
            }
          >
            {name}
          </span>
        </label>
        {ineligible || missingQuota || !invited ? (
          <p
            className={`mx-0 -mt-1 mb-1.5 pl-7 text-[0.8125rem] leading-[1.45] ${missingQuota ? "text-destructive" : "text-muted-foreground"}`}
          >
            {ineligible
              ? `Can’t play yet: ${ineligibleReason(member.eligibilityReason)}`
              : missingQuota
                ? "Needs a quota before you can publish"
                : "Not invited"}
          </p>
        ) : null}
      </div>
      {invited ? (
        <div
          className="grid shrink-0 gap-0.5 pt-3 text-right text-xs text-muted-foreground max-[480px]:pt-0 max-[480px]:pb-2 max-[480px]:pl-7 max-[480px]:text-left"
          data-slot="row-meta"
        >
          {member.projectedQuota ? (
            <span className="font-mono text-foreground">
              Quota {member.projectedQuota}
            </span>
          ) : null}
          <span>{member.emailReady ? "Gets e-mail" : "Won’t get e-mail"}</span>
        </div>
      ) : null}
    </li>
  );
}

function SummaryItem({
  label,
  value,
  warning = false,
}: Readonly<{ label: string; value: number; warning?: boolean }>) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd
        className={`m-0 font-mono text-base font-medium tabular-nums ${warning ? "text-destructive" : value === 0 ? "text-muted-foreground" : "text-foreground"}`}
      >
        {value}
      </dd>
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
