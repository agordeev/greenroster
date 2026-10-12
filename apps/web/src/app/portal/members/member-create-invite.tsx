"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import type { FormEvent } from "react";

import {
  createPendingMemberProfileAction,
  issueMembershipInvitationAction,
  setMemberHandicapAction,
} from "@/app/actions/memberships";
import { FieldHelp, FormMessage, Kicker } from "@/components/blocks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { signInPath } from "@/lib/auth/safe-return-path";
import { shouldAllowDirtyNavigation } from "@/lib/groups/quota-settings-form-rules";
import type { MemberRole } from "@/lib/memberships/member-management";

import {
  buildMemberProfileCreatePayload,
  buildMemberHandicapRecordPayload,
  canCreatePendingMember,
  emptyMemberCreateInviteDraft,
  memberCreateInviteRecoveryStorageKey,
  memberCreateRequiresHandicapBeforeInvite,
  parseMemberCreateInviteRecovery,
  retainMemberCreateInviteOperationId,
  serializeMemberCreateInviteRecovery,
  shouldResetMemberCreateConfirmation,
  type MemberCreateInviteDraft,
  type MemberCreateInviteOperationState,
  type MemberCreateInvitePhase,
  type TeeLocation,
} from "./member-create-invite-state";

const emptyOperationState: MemberCreateInviteOperationState = {
  fingerprint: null,
  operationId: null,
};

export function MemberCreateInvite({ role }: Readonly<{ role: MemberRole }>) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState<MemberCreateInviteDraft>(
    emptyMemberCreateInviteDraft,
  );
  const [phase, setPhase] = useState<MemberCreateInvitePhase>("idle");
  const [message, setMessage] = useState("");
  const [messageStatus, setMessageStatus] = useState<"success" | "error">(
    "error",
  );
  const [handicapRecorded, setHandicapRecorded] = useState(false);
  const [createdMembershipId, setCreatedMembershipId] = useState<string | null>(
    null,
  );
  const createOperation = useRef(emptyOperationState);
  const inviteOperation = useRef(emptyOperationState);
  const handicapOperation = useRef(emptyOperationState);

  useEffect(() => {
    let cancelled = false;
    let recovery: ReturnType<typeof parseMemberCreateInviteRecovery>;
    try {
      recovery = parseMemberCreateInviteRecovery(
        window.sessionStorage.getItem(memberCreateInviteRecoveryStorageKey),
      );
    } catch {
      recovery = null;
    }
    if (!recovery) return;
    try {
      window.sessionStorage.removeItem(memberCreateInviteRecoveryStorageKey);
    } catch {
      // The in-memory recovery below remains usable when storage is blocked.
    }
    queueMicrotask(() => {
      if (cancelled) return;
      // Confirmation is intentionally re-established after a session
      // recovery; the values and operation id remain retryable, but a stale
      // browser snapshot cannot silently authorize the consequential action.
      setDraft({ ...recovery.draft, handicapConfirmed: false });
      setCreatedMembershipId(recovery.createdMembershipId);
      setHandicapRecorded(false);
      setPhase(recovery.createdMembershipId ? "ready" : "idle");
      setMessageStatus("success");
      setMessage("Your unsaved changes are back.");
      createOperation.current = recovery.createOperation;
      inviteOperation.current = recovery.inviteOperation;
      handicapOperation.current = recovery.handicapOperation;
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const memberCreated = createdMembershipId !== null;
  const handicapRequiredBeforeInvite = memberCreateRequiresHandicapBeforeInvite(
    draft,
    handicapRecorded,
  );
  const draftDirty = memberCreated
    ? handicapRequiredBeforeInvite
    : JSON.stringify(draft) !== JSON.stringify(emptyMemberCreateInviteDraft);

  useEffect(() => {
    function warnBeforeUnload(event: BeforeUnloadEvent) {
      if (!draftDirty) return;
      event.preventDefault();
      event.returnValue = "";
    }

    function confirmLinkNavigation(event: MouseEvent) {
      if (!draftDirty || event.defaultPrevented || event.button !== 0) return;
      const target = event.target;
      const link =
        target instanceof Element
          ? target.closest<HTMLAnchorElement>("a[href]")
          : null;
      if (!link) return;
      if (
        !shouldAllowDirtyNavigation(draftDirty, () =>
          window.confirm("Discard this unsaved new member?"),
        )
      ) {
        event.preventDefault();
        event.stopPropagation();
      }
    }

    function confirmOtherFormSubmission(event: SubmitEvent) {
      const form = event.target;
      if (
        !draftDirty ||
        !(form instanceof HTMLFormElement) ||
        form.dataset.form === "member-create-form" ||
        form.dataset.form === "member-invite-form" ||
        form.dataset.form === "member-handicap-form"
      ) {
        return;
      }
      if (
        !shouldAllowDirtyNavigation(draftDirty, () =>
          window.confirm("Discard this unsaved new member?"),
        )
      ) {
        event.preventDefault();
        event.stopPropagation();
      }
    }

    window.addEventListener("beforeunload", warnBeforeUnload);
    document.addEventListener("click", confirmLinkNavigation, true);
    document.addEventListener("submit", confirmOtherFormSubmission, true);
    return () => {
      window.removeEventListener("beforeunload", warnBeforeUnload);
      document.removeEventListener("click", confirmLinkNavigation, true);
      document.removeEventListener("submit", confirmOtherFormSubmission, true);
    };
  }, [draftDirty]);

  if (!canCreatePendingMember(role)) {
    return null;
  }

  const busy =
    pending ||
    phase === "creating" ||
    phase === "inviting" ||
    phase === "recording-handicap";

  function update<K extends keyof MemberCreateInviteDraft>(
    key: K,
    value: MemberCreateInviteDraft[K],
  ) {
    if (shouldResetMemberCreateConfirmation(createdMembershipId)) {
      setPhase("idle");
      setMessage("");
    }
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function setError(nextMessage: string) {
    setPhase(memberCreated ? "ready" : "error");
    setMessageStatus("error");
    setMessage(nextMessage);
  }

  function submitCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || memberCreated) return;

    const firstName = draft.firstName.trim();
    const lastName = draft.lastName.trim();
    const invitedEmail = normalizeEmail(draft.invitedEmail);
    if (!firstName || !lastName || !isEmail(invitedEmail)) {
      setError(
        "Enter the member's first name, last name, and a valid invite e-mail.",
      );
      return;
    }

    // Keep the idempotency fingerprint identical to the profile action input.
    // The invite address belongs only to the later invitation operation.
    const payload = buildMemberProfileCreatePayload(draft);
    createOperation.current = retainMemberCreateInviteOperationId(
      createOperation.current,
      "create",
      payload,
      () => crypto.randomUUID(),
    );
    const operationId = createOperation.current.operationId;
    if (!operationId) {
      setError("We couldn't add this member. Try again.");
      return;
    }

    setMessage("");
    setPhase("creating");
    startTransition(async () => {
      try {
        const result = await createPendingMemberProfileAction({
          ...payload,
          operationId,
        });

        if (!result.ok) {
          handleMutationError(result.error.code, result.error.message);
          return;
        }

        setCreatedMembershipId(result.data.membershipId);
        setPhase("ready");
        setMessageStatus("success");
        setMessage("Member added. Send their invitation below.");
      } catch {
        setError("We couldn't add this member. Try again.");
      }
    });
  }

  function submitHandicap(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !createdMembershipId) return;

    const handicap = draft.handicap.trim();
    const asOf = draft.handicapAsOf.trim();
    if (!handicap || !asOf) {
      setError("Enter a handicap and date before saving it.");
      return;
    }
    if (!draft.handicapReason.trim()) {
      setError("Add a reason before saving the handicap.");
      return;
    }
    if (!draft.handicapConfirmed) {
      setError("Confirm the handicap details before saving them.");
      return;
    }

    const payload = buildMemberHandicapRecordPayload(
      draft,
      createdMembershipId,
    );
    handicapOperation.current = retainMemberCreateInviteOperationId(
      handicapOperation.current,
      "handicap",
      payload,
      () => crypto.randomUUID(),
    );
    const operationId = handicapOperation.current.operationId;
    if (!operationId) {
      setError("We couldn't save the handicap. Try again.");
      return;
    }

    setMessage("");
    setPhase("recording-handicap");
    startTransition(async () => {
      try {
        const result = await setMemberHandicapAction({
          ...payload,
          operationId,
        });
        if (!result.ok) {
          handleMutationError(result.error.code, result.error.message);
          return;
        }
        setMessageStatus("success");
        setMessage("Handicap saved. You can now send the invitation.");
        setHandicapRecorded(true);
        setPhase("ready");
      } catch {
        setError("We couldn't save the handicap. Try again.");
      }
    });
  }

  function submitInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !createdMembershipId) return;

    if (handicapRequiredBeforeInvite) {
      setError(
        "Save the handicap before sending the invitation, or clear the handicap fields.",
      );
      return;
    }

    const invitedEmail = normalizeEmail(draft.invitedEmail);
    if (!isEmail(invitedEmail)) {
      setError("Enter a valid invite e-mail before sending the invitation.");
      return;
    }

    const payload = {
      membershipId: createdMembershipId,
      invitedEmail,
    };
    inviteOperation.current = retainMemberCreateInviteOperationId(
      inviteOperation.current,
      "invite",
      payload,
      () => crypto.randomUUID(),
    );
    const operationId = inviteOperation.current.operationId;
    if (!operationId) {
      setError("We couldn't send the invitation. Try again.");
      return;
    }

    setMessage("");
    setPhase("inviting");
    startTransition(async () => {
      try {
        const result = await issueMembershipInvitationAction({
          membershipId: createdMembershipId,
          invitedEmail,
          operationId,
        });

        if (!result.ok) {
          handleMutationError(result.error.code, result.error.message);
          return;
        }

        // The server returns a one-time URL for authorized hand-off flows. It
        // is intentionally not rendered here; administrators can manage the
        // delivery state from Invitations without exposing the token.
        setPhase("success");
        setMessageStatus("success");
        setMessage("Invitation on its way. Opening the member…");
        clearRecoveryState();
        setDraft(emptyMemberCreateInviteDraft);
        setHandicapRecorded(false);
        setCreatedMembershipId(null);
        createOperation.current = emptyOperationState;
        inviteOperation.current = emptyOperationState;
        handicapOperation.current = emptyOperationState;
        router.replace(`/portal/members?membership=${createdMembershipId}`);
      } catch {
        setError("We couldn't send the invitation. Try again.");
      }
    });
  }

  function handleMutationError(code: string, errorMessage: string) {
    if (code === "authentication_required") {
      preserveRecoveryState();
      router.replace(signInPath("/portal/members"));
      return;
    }
    if (code === "stale_version" && createdMembershipId) {
      preserveHandicapForMemberEditor(createdMembershipId);
      router.replace(
        `/portal/members?membership=${encodeURIComponent(createdMembershipId)}`,
      );
      return;
    }
    setError(errorMessage);
  }

  function reset() {
    if (busy) return;
    if (
      !shouldAllowDirtyNavigation(draftDirty, () =>
        window.confirm("Discard this new member?"),
      )
    ) {
      return;
    }
    clearRecoveryState();
    setDraft(emptyMemberCreateInviteDraft);
    setPhase("idle");
    setMessage("");
    setMessageStatus("error");
    setHandicapRecorded(false);
    setCreatedMembershipId(null);
    createOperation.current = emptyOperationState;
    inviteOperation.current = emptyOperationState;
    handicapOperation.current = emptyOperationState;
  }

  function preserveRecoveryState() {
    try {
      window.sessionStorage.setItem(
        memberCreateInviteRecoveryStorageKey,
        serializeMemberCreateInviteRecovery({
          draft,
          createdMembershipId,
          createOperation: createOperation.current,
          inviteOperation: inviteOperation.current,
          handicapOperation: handicapOperation.current,
        }),
      );
    } catch {
      // Private browsing or a storage quota failure must not block sign-in.
    }
  }

  function clearRecoveryState() {
    try {
      window.sessionStorage.removeItem(memberCreateInviteRecoveryStorageKey);
    } catch {
      // Storage is best-effort recovery only.
    }
  }

  function preserveHandicapForMemberEditor(membershipId: string) {
    try {
      window.sessionStorage.setItem(
        `greenroster:member-handicap:${membershipId}`,
        JSON.stringify({
          handicapId: draft.handicapId,
          handicap: draft.handicap,
          asOf: draft.handicapAsOf,
          reason: draft.handicapReason,
          confirmed: false,
        }),
      );
    } catch {
      // The authoritative member editor still loads even without draft storage.
    }
  }

  return (
    <section
      className="mt-10 p-6 gap-5 border grid bg-muted"
      aria-labelledby="member-create-title"
    >
      <div className="pb-4 gap-4 border-b border-b-border/50 flex items-start justify-between max-[720px]:grid-cols-[1fr] [&_h2]:mx-0 [&_h2]:mt-[0.35rem] [&_h2]:mb-0 [&_h2]:text-[1.5rem] [&_h2]:font-semibold">
        <div>
          <Kicker>New member</Kicker>
          <h2 id="member-create-title">Create and invite</h2>
        </div>
        <span className="text-muted-foreground text-[0.6875rem] font-bold tracking-[0.08em] uppercase">
          {memberCreated ? "Step 2 of 2" : "Step 1 of 2"}
        </span>
      </div>

      <form
        className="gap-5 grid [&>fieldset]:m-0 [&>fieldset]:p-0 [&>fieldset]:gap-5 [&>fieldset]:border-0 [&>fieldset]:grid [&>fieldset]:min-w-0 [&_[data-slot=member-contact-fieldset]]:p-4 [&_legend]:mb-1 [&_legend]:text-[1.125rem] [&_legend]:font-semibold"
        data-form="member-create-form"
        onSubmit={submitCreate}
        noValidate
      >
        <fieldset disabled={busy || memberCreated}>
          <legend>Member details</legend>
          <div className="gap-4 grid grid-cols-2 max-[720px]:grid-cols-[1fr]">
            <label
              className="gap-2 grid [&>label]:text-[0.8125rem] [&>label]:font-bold [&>label]:tracking-[0.015em] [&>span]:text-[0.8125rem] [&>span]:font-bold [&>span]:tracking-[0.015em]"
              data-slot="field"
              htmlFor="member-create-first-name"
            >
              <span>First name</span>
              <Input
                id="member-create-first-name"
                name="firstName"
                value={draft.firstName}
                onChange={(event) => update("firstName", event.target.value)}
                autoComplete="given-name"
                required
              />
            </label>
            <label
              className="gap-2 grid [&>label]:text-[0.8125rem] [&>label]:font-bold [&>label]:tracking-[0.015em] [&>span]:text-[0.8125rem] [&>span]:font-bold [&>span]:tracking-[0.015em]"
              data-slot="field"
              htmlFor="member-create-last-name"
            >
              <span>Last name</span>
              <Input
                id="member-create-last-name"
                name="lastName"
                value={draft.lastName}
                onChange={(event) => update("lastName", event.target.value)}
                autoComplete="family-name"
                required
              />
            </label>
            <label
              className="gap-2 grid [&>label]:text-[0.8125rem] [&>label]:font-bold [&>label]:tracking-[0.015em] [&>span]:text-[0.8125rem] [&>span]:font-bold [&>span]:tracking-[0.015em]"
              data-slot="field"
              htmlFor="member-create-email"
            >
              <span>Invite e-mail</span>
              <Input
                id="member-create-email"
                name="invitedEmail"
                type="email"
                value={draft.invitedEmail}
                onChange={(event) => {
                  update("invitedEmail", event.target.value);
                  inviteOperation.current = emptyOperationState;
                }}
                autoComplete="email"
                required
              />
            </label>
            <label
              className="gap-2 grid [&>label]:text-[0.8125rem] [&>label]:font-bold [&>label]:tracking-[0.015em] [&>span]:text-[0.8125rem] [&>span]:font-bold [&>span]:tracking-[0.015em]"
              data-slot="field"
              htmlFor="member-create-tee"
            >
              <span>Preferred tee</span>
              <NativeSelect
                id="member-create-tee"
                name="teeLocation"
                value={draft.teeLocation}
                onChange={(event) =>
                  update("teeLocation", event.target.value as TeeLocation | "")
                }
              >
                <option value="">Not set</option>
                <option value="pro">Pro</option>
                <option value="back">Back</option>
                <option value="middle">Middle</option>
                <option value="front">Front</option>
              </NativeSelect>
            </label>
            <label
              className="gap-2 grid [&>label]:text-[0.8125rem] [&>label]:font-bold [&>label]:tracking-[0.015em] [&>span]:text-[0.8125rem] [&>span]:font-bold [&>span]:tracking-[0.015em]"
              data-slot="field"
              htmlFor="member-create-spouse-first"
            >
              <span>Spouse first name (optional)</span>
              <Input
                id="member-create-spouse-first"
                name="spouseFirstName"
                value={draft.spouseFirstName}
                onChange={(event) =>
                  update("spouseFirstName", event.target.value)
                }
              />
            </label>
            <label
              className="gap-2 grid [&>label]:text-[0.8125rem] [&>label]:font-bold [&>label]:tracking-[0.015em] [&>span]:text-[0.8125rem] [&>span]:font-bold [&>span]:tracking-[0.015em]"
              data-slot="field"
              htmlFor="member-create-spouse-last"
            >
              <span>Spouse last name (optional)</span>
              <Input
                id="member-create-spouse-last"
                name="spouseLastName"
                value={draft.spouseLastName}
                onChange={(event) =>
                  update("spouseLastName", event.target.value)
                }
              />
            </label>
            <label
              className="gap-2 flex items-center min-h-11 text-muted-foreground text-[0.8125rem]"
              htmlFor="member-create-dues"
            >
              <Checkbox
                id="member-create-dues"
                name="duesPaid"
                checked={draft.duesPaid}
                onCheckedChange={(checked) =>
                  update("duesPaid", checked === true)
                }
              />
              <span>Dues paid</span>
            </label>
            <label
              className="gap-2 grid [&>label]:text-[0.8125rem] [&>label]:font-bold [&>label]:tracking-[0.015em] [&>span]:text-[0.8125rem] [&>span]:font-bold [&>span]:tracking-[0.015em]"
              data-slot="field"
              htmlFor="member-create-reason"
            >
              <span>Reason (optional)</span>
              <Input
                id="member-create-reason"
                name="reason"
                value={draft.reason}
                onChange={(event) => update("reason", event.target.value)}
              />
            </label>
          </div>
          <fieldset
            className="m-0 p-4 gap-4 grid border! border-border/50! [&_legend]:mb-1 [&_legend]:text-[1.125rem] [&_legend]:font-semibold"
            data-slot="member-contact-fieldset"
          >
            <legend>Contact details (optional)</legend>
            <div className="gap-4 grid grid-cols-2 max-[720px]:grid-cols-[1fr]">
              <label
                className="gap-2 grid [&>label]:text-[0.8125rem] [&>label]:font-bold [&>label]:tracking-[0.015em] [&>span]:text-[0.8125rem] [&>span]:font-bold [&>span]:tracking-[0.015em]"
                data-slot="field"
                htmlFor="member-create-secondary-email"
              >
                <span>Secondary e-mail</span>
                <Input
                  id="member-create-secondary-email"
                  name="secondaryEmail"
                  type="email"
                  value={draft.secondaryEmail}
                  onChange={(event) =>
                    update("secondaryEmail", event.target.value)
                  }
                  autoComplete="email"
                />
              </label>
              <label
                className="gap-2 grid [&>label]:text-[0.8125rem] [&>label]:font-bold [&>label]:tracking-[0.015em] [&>span]:text-[0.8125rem] [&>span]:font-bold [&>span]:tracking-[0.015em]"
                data-slot="field"
                htmlFor="member-create-home-phone"
              >
                <span>Home phone</span>
                <Input
                  id="member-create-home-phone"
                  name="homePhone"
                  type="tel"
                  value={draft.homePhone}
                  onChange={(event) => update("homePhone", event.target.value)}
                  autoComplete="tel"
                />
              </label>
              <label
                className="gap-2 grid [&>label]:text-[0.8125rem] [&>label]:font-bold [&>label]:tracking-[0.015em] [&>span]:text-[0.8125rem] [&>span]:font-bold [&>span]:tracking-[0.015em]"
                data-slot="field"
                htmlFor="member-create-work-phone"
              >
                <span>Work phone</span>
                <Input
                  id="member-create-work-phone"
                  name="workPhone"
                  type="tel"
                  value={draft.workPhone}
                  onChange={(event) => update("workPhone", event.target.value)}
                  autoComplete="tel"
                />
              </label>
              <label
                className="gap-2 grid [&>label]:text-[0.8125rem] [&>label]:font-bold [&>label]:tracking-[0.015em] [&>span]:text-[0.8125rem] [&>span]:font-bold [&>span]:tracking-[0.015em]"
                data-slot="field"
                htmlFor="member-create-mobile-phone"
              >
                <span>Mobile phone</span>
                <Input
                  id="member-create-mobile-phone"
                  name="mobilePhone"
                  type="tel"
                  value={draft.mobilePhone}
                  onChange={(event) =>
                    update("mobilePhone", event.target.value)
                  }
                  autoComplete="tel"
                />
              </label>
            </div>
          </fieldset>

          <fieldset
            className="m-0 p-4 gap-4 grid border! border-border/50! [&_legend]:mb-1 [&_legend]:text-[1.125rem] [&_legend]:font-semibold"
            data-slot="member-contact-fieldset"
          >
            <legend>Postal address (optional)</legend>
            <div className="gap-4 grid grid-cols-2 max-[720px]:grid-cols-[1fr]">
              <label
                className="gap-2 grid [&>label]:text-[0.8125rem] [&>label]:font-bold [&>label]:tracking-[0.015em] [&>span]:text-[0.8125rem] [&>span]:font-bold [&>span]:tracking-[0.015em]"
                data-slot="field"
                htmlFor="member-create-address-line1"
              >
                <span>Address line 1</span>
                <Input
                  id="member-create-address-line1"
                  name="addressLine1"
                  value={draft.addressLine1}
                  onChange={(event) =>
                    update("addressLine1", event.target.value)
                  }
                  autoComplete="address-line1"
                />
              </label>
              <label
                className="gap-2 grid [&>label]:text-[0.8125rem] [&>label]:font-bold [&>label]:tracking-[0.015em] [&>span]:text-[0.8125rem] [&>span]:font-bold [&>span]:tracking-[0.015em]"
                data-slot="field"
                htmlFor="member-create-address-line2"
              >
                <span>Address line 2</span>
                <Input
                  id="member-create-address-line2"
                  name="addressLine2"
                  value={draft.addressLine2}
                  onChange={(event) =>
                    update("addressLine2", event.target.value)
                  }
                  autoComplete="address-line2"
                />
              </label>
              <label
                className="gap-2 grid [&>label]:text-[0.8125rem] [&>label]:font-bold [&>label]:tracking-[0.015em] [&>span]:text-[0.8125rem] [&>span]:font-bold [&>span]:tracking-[0.015em]"
                data-slot="field"
                htmlFor="member-create-city"
              >
                <span>City</span>
                <Input
                  id="member-create-city"
                  name="city"
                  value={draft.city}
                  onChange={(event) => update("city", event.target.value)}
                  autoComplete="address-level2"
                />
              </label>
              <label
                className="gap-2 grid [&>label]:text-[0.8125rem] [&>label]:font-bold [&>label]:tracking-[0.015em] [&>span]:text-[0.8125rem] [&>span]:font-bold [&>span]:tracking-[0.015em]"
                data-slot="field"
                htmlFor="member-create-state-region"
              >
                <span>State / region</span>
                <Input
                  id="member-create-state-region"
                  name="stateRegion"
                  value={draft.stateRegion}
                  onChange={(event) =>
                    update("stateRegion", event.target.value)
                  }
                  autoComplete="address-level1"
                />
              </label>
              <label
                className="gap-2 grid [&>label]:text-[0.8125rem] [&>label]:font-bold [&>label]:tracking-[0.015em] [&>span]:text-[0.8125rem] [&>span]:font-bold [&>span]:tracking-[0.015em]"
                data-slot="field"
                htmlFor="member-create-postal-code"
              >
                <span>Postal code</span>
                <Input
                  id="member-create-postal-code"
                  name="postalCode"
                  value={draft.postalCode}
                  onChange={(event) => update("postalCode", event.target.value)}
                  autoComplete="postal-code"
                />
              </label>
              <label
                className="gap-2 grid [&>label]:text-[0.8125rem] [&>label]:font-bold [&>label]:tracking-[0.015em] [&>span]:text-[0.8125rem] [&>span]:font-bold [&>span]:tracking-[0.015em]"
                data-slot="field"
                htmlFor="member-create-country"
              >
                <span>Country</span>
                <Input
                  id="member-create-country"
                  name="country"
                  value={draft.country}
                  onChange={(event) => update("country", event.target.value)}
                  autoComplete="country-name"
                />
              </label>
            </div>
          </fieldset>

          <fieldset
            className="m-0 p-4 gap-4 grid border! border-border/50! [&_legend]:mb-1 [&_legend]:text-[1.125rem] [&_legend]:font-semibold"
            data-slot="member-contact-fieldset"
          >
            <legend>Handicap (optional)</legend>
            <FieldHelp>
              Enter the handicap here. You&apos;ll save it in the next step,
              after you add the member.
            </FieldHelp>
            <HandicapFields
              draft={draft}
              idPrefix="member-create"
              onChange={(key, value) => update(key, value)}
            />
          </fieldset>

          <fieldset
            className="m-0 p-4 gap-4 grid border! border-border/50! [&_legend]:mb-1 [&_legend]:text-[1.125rem] [&_legend]:font-semibold"
            data-slot="member-contact-fieldset"
          >
            <legend>Show in the member directory</legend>
            <div className="flex flex-wrap gap-y-3 gap-x-4">
              <label
                className="gap-2 flex items-center min-h-11 text-muted-foreground text-[0.8125rem]"
                htmlFor="member-create-secondary-visible"
              >
                <Checkbox
                  id="member-create-secondary-visible"
                  checked={draft.secondaryEmailVisible}
                  onCheckedChange={(checked) =>
                    update("secondaryEmailVisible", checked === true)
                  }
                />
                <span>List secondary e-mail</span>
              </label>
              <label
                className="gap-2 flex items-center min-h-11 text-muted-foreground text-[0.8125rem]"
                htmlFor="member-create-home-visible"
              >
                <Checkbox
                  id="member-create-home-visible"
                  checked={draft.homePhoneVisible}
                  onCheckedChange={(checked) =>
                    update("homePhoneVisible", checked === true)
                  }
                />
                <span>List home phone</span>
              </label>
              <label
                className="gap-2 flex items-center min-h-11 text-muted-foreground text-[0.8125rem]"
                htmlFor="member-create-work-visible"
              >
                <Checkbox
                  id="member-create-work-visible"
                  checked={draft.workPhoneVisible}
                  onCheckedChange={(checked) =>
                    update("workPhoneVisible", checked === true)
                  }
                />
                <span>List work phone</span>
              </label>
              <label
                className="gap-2 flex items-center min-h-11 text-muted-foreground text-[0.8125rem]"
                htmlFor="member-create-mobile-visible"
              >
                <Checkbox
                  id="member-create-mobile-visible"
                  checked={draft.mobilePhoneVisible}
                  onCheckedChange={(checked) =>
                    update("mobilePhoneVisible", checked === true)
                  }
                />
                <span>List mobile phone</span>
              </label>
              <label
                className="gap-2 flex items-center min-h-11 text-muted-foreground text-[0.8125rem]"
                htmlFor="member-create-address-listed"
              >
                <Checkbox
                  id="member-create-address-listed"
                  checked={draft.addressListed}
                  onCheckedChange={(checked) =>
                    update("addressListed", checked === true)
                  }
                />
                <span>List postal address</span>
              </label>
            </div>
          </fieldset>
        </fieldset>
        <div className="gap-3 flex flex-wrap">
          <Button type="submit" disabled={busy || memberCreated}>
            {phase === "creating" ? "Adding…" : "Add member"}
          </Button>
          {memberCreated ? (
            <Button
              variant="outline"
              type="button"
              onClick={reset}
              disabled={busy}
            >
              Add another member
            </Button>
          ) : null}
        </div>
      </form>

      {createdMembershipId ? (
        <form
          className="my-0 mx-5 pt-5 gap-5 border-t border-t-border/50 grid [&_fieldset]:m-0 [&_fieldset]:p-0 [&_fieldset]:gap-5 [&_fieldset]:border-0 [&_fieldset]:grid [&_fieldset]:min-w-0"
          data-form="member-handicap-form"
          onSubmit={submitHandicap}
          noValidate
        >
          <fieldset disabled={busy || handicapRecorded}>
            <legend>Save handicap</legend>
            <p>
              Member added. If you entered a handicap, save it before sending
              the invitation.
            </p>
            <HandicapFields
              draft={draft}
              idPrefix="member-handicap"
              onChange={(key, value) => update(key, value)}
            />
          </fieldset>
          <div className="gap-3 flex flex-wrap">
            <Button
              variant="outline"
              type="submit"
              disabled={busy || handicapRecorded}
            >
              {phase === "recording-handicap"
                ? "Recording…"
                : handicapRecorded
                  ? "Handicap saved"
                  : "Save handicap"}
            </Button>
            <Button
              variant="link"
              size="inline"
              type="button"
              onClick={() =>
                router.push(
                  `/portal/members?membership=${encodeURIComponent(createdMembershipId)}`,
                )
              }
              disabled={busy}
            >
              Open member details
            </Button>
          </div>
        </form>
      ) : null}

      {createdMembershipId ? (
        <form
          className="pt-5 gap-5 border-t border-t-border/50 grid [&>fieldset]:m-0 [&>fieldset]:p-0 [&>fieldset]:gap-5 [&>fieldset]:border-0 [&>fieldset]:grid [&>fieldset]:min-w-0 [&_code]:text-foreground [&_code]:text-[0.75rem] [&_code]:wrap-anywhere [&_legend]:mb-1 [&_legend]:text-[1.125rem] [&_legend]:font-semibold [&_p]:m-0 [&_p]:text-muted-foreground [&_p]:leading-[1.5]"
          data-form="member-invite-form"
          onSubmit={submitInvite}
          noValidate
        >
          <fieldset disabled={busy || handicapRequiredBeforeInvite}>
            <legend>Send invitation</legend>
            <p>
              This member hasn&apos;t been invited yet. Send the invitation when
              you&apos;re ready.
            </p>
            <label
              className="gap-2 grid [&>label]:text-[0.8125rem] [&>label]:font-bold [&>label]:tracking-[0.015em] [&>span]:text-[0.8125rem] [&>span]:font-bold [&>span]:tracking-[0.015em]"
              data-slot="field"
              htmlFor="member-invite-email"
            >
              <span>Invite e-mail</span>
              <Input
                id="member-invite-email"
                name="invitedEmail"
                type="email"
                value={draft.invitedEmail}
                onChange={(event) => {
                  update("invitedEmail", event.target.value);
                  inviteOperation.current = emptyOperationState;
                }}
                autoComplete="email"
                required
              />
            </label>
          </fieldset>
          <div className="gap-3 flex flex-wrap">
            <Button
              type="submit"
              disabled={busy || handicapRequiredBeforeInvite}
            >
              {phase === "inviting" ? "Sending…" : "Send invitation"}
            </Button>
            {handicapRequiredBeforeInvite ? (
              <FieldHelp role="status">
                Save the handicap before sending the invitation.
              </FieldHelp>
            ) : null}
          </div>
        </form>
      ) : null}

      <FormMessage
        tone={messageStatus === "success" ? "success" : "error"}
        aria-live="polite"
        data-status={message ? messageStatus : undefined}
      >
        {message}
      </FormMessage>
    </section>
  );
}

type HandicapDraftKey =
  | "handicapId"
  | "handicap"
  | "handicapAsOf"
  | "handicapReason"
  | "handicapConfirmed";

function HandicapFields({
  draft,
  idPrefix,
  onChange,
}: Readonly<{
  draft: MemberCreateInviteDraft;
  idPrefix: string;
  onChange: <K extends HandicapDraftKey>(
    key: K,
    value: MemberCreateInviteDraft[K],
  ) => void;
}>) {
  return (
    <>
      <div className="gap-4 grid grid-cols-2 max-[720px]:grid-cols-[1fr]">
        <label
          className="gap-2 grid [&>label]:text-[0.8125rem] [&>label]:font-bold [&>label]:tracking-[0.015em] [&>span]:text-[0.8125rem] [&>span]:font-bold [&>span]:tracking-[0.015em]"
          data-slot="field"
          htmlFor={`${idPrefix}-handicap-id`}
        >
          <span>Handicap ID (optional)</span>
          <Input
            id={`${idPrefix}-handicap-id`}
            name="handicapId"
            value={draft.handicapId}
            onChange={(event) => onChange("handicapId", event.target.value)}
            autoComplete="off"
          />
        </label>
        <label
          className="gap-2 grid [&>label]:text-[0.8125rem] [&>label]:font-bold [&>label]:tracking-[0.015em] [&>span]:text-[0.8125rem] [&>span]:font-bold [&>span]:tracking-[0.015em]"
          data-slot="field"
          htmlFor={`${idPrefix}-handicap-value`}
        >
          <span>Handicap</span>
          <Input
            id={`${idPrefix}-handicap-value`}
            name="handicap"
            type="number"
            inputMode="decimal"
            min="-10"
            max="54"
            step="0.1"
            value={draft.handicap}
            onChange={(event) => onChange("handicap", event.target.value)}
          />
        </label>
        <label
          className="gap-2 grid [&>label]:text-[0.8125rem] [&>label]:font-bold [&>label]:tracking-[0.015em] [&>span]:text-[0.8125rem] [&>span]:font-bold [&>span]:tracking-[0.015em]"
          data-slot="field"
          htmlFor={`${idPrefix}-handicap-as-of`}
        >
          <span>Handicap date</span>
          <Input
            id={`${idPrefix}-handicap-as-of`}
            name="handicapAsOf"
            type="date"
            value={draft.handicapAsOf}
            onChange={(event) => onChange("handicapAsOf", event.target.value)}
          />
        </label>
      </div>
      <label
        className="gap-2 grid [&>label]:text-[0.8125rem] [&>label]:font-bold [&>label]:tracking-[0.015em] [&>span]:text-[0.8125rem] [&>span]:font-bold [&>span]:tracking-[0.015em]"
        data-slot="field"
        htmlFor={`${idPrefix}-handicap-reason`}
      >
        <span>Reason (required to save a handicap)</span>
        <Textarea
          id={`${idPrefix}-handicap-reason`}
          name="handicapReason"
          value={draft.handicapReason}
          onChange={(event) => onChange("handicapReason", event.target.value)}
          maxLength={500}
          rows={3}
        />
      </label>
      <label
        className="gap-2 flex items-start text-muted-foreground text-[0.8125rem] leading-[1.45]"
        htmlFor={`${idPrefix}-handicap-confirm`}
      >
        <Checkbox
          id={`${idPrefix}-handicap-confirm`}
          name="handicapConfirmed"
          checked={draft.handicapConfirmed}
          onCheckedChange={(checked) =>
            onChange("handicapConfirmed", checked === true)
          }
        />
        <span>I confirm this handicap and its date.</span>
      </label>
    </>
  );
}

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

function isEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}
