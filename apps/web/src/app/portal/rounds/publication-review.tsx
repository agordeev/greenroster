"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import {
  previewRoundPublicationAction,
  publishRoundAction,
} from "@/app/actions/rounds";
import { ActionRow, SectionHeading } from "@/components/ui";
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
      className="page-section publication-review"
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

      <dl className="publication-summary" aria-label="Player summary">
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

      <div className="publication-member-list">
        <h3>Members to review</h3>
        <ul className="row-list">
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

      <p
        className="form-message"
        aria-live="polite"
        data-status={messageTone || undefined}
      >
        {message}
      </p>
      <ActionRow>
        <button
          className="primary-button"
          type="button"
          onClick={() => void publish()}
          disabled={
            pending || draftDirty || review.summary.missingQuotaCount > 0
          }
        >
          {pending ? "Working…" : "Publish round"}
        </button>
      </ActionRow>
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
    <li className="row-item publication-member-row">
      <div>
        <label className="bound-choice">
          <input
            aria-label={`Exclude ${publicationMemberName(member)}`}
            type="checkbox"
            checked={
              explicitlyExcluded ||
              (member.eligibilityState === "eligible" && !member.included)
            }
            disabled={disabled}
            onChange={(event) =>
              void onToggle(member.membershipId, event.target.checked)
            }
          />
          <span>Exclude</span> <strong>{publicationMemberName(member)}</strong>
        </label>
        <p>
          {ineligible
            ? `Not eligible: ${member.eligibilityReason ?? "no reason given"}`
            : explicitlyExcluded
              ? "Excluded"
              : member.included
                ? missingQuota
                  ? "Included · quota missing"
                  : "Included"
                : "Excluded"}
        </p>
      </div>
      <div className="row-meta">
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
