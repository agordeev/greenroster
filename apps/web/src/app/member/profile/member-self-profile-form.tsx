"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import {
  setMemberSelfHandicapAction,
  updateMemberSelfProfileAction,
} from "@/app/actions/member-profile";
import type {
  MemberSelfProfile,
  MemberSelfProfileDraft,
} from "@/domain/member-self-profile";

export function MemberSelfProfileForm({
  initialProfile,
}: Readonly<{ initialProfile: MemberSelfProfile }>) {
  const router = useRouter();
  const [profile, setProfile] = useState(initialProfile);
  const [draft, setDraft] = useState(initialProfile.draft);
  const [handicapId, setHandicapId] = useState(initialProfile.handicapId ?? "");
  const [handicap, setHandicap] = useState(initialProfile.handicap ?? "");
  const [handicapAsOf, setHandicapAsOf] = useState(
    initialProfile.handicapAsOf ?? new Date().toISOString().slice(0, 10),
  );
  const [handicapReason, setHandicapReason] = useState("");
  const [handicapConfirmed, setHandicapConfirmed] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageTone, setMessageTone] = useState<"error" | "success">(
    "success",
  );
  const [pending, startTransition] = useTransition();

  function updateDraft<K extends keyof MemberSelfProfileDraft>(
    field: K,
    value: MemberSelfProfileDraft[K],
  ) {
    setDraft((current) => ({ ...current, [field]: value }));
  }

  function saveProfile() {
    setMessage(null);
    startTransition(async () => {
      const result = await updateMemberSelfProfileAction({
        ...draft,
        expectedProfileVersion: profile.profileVersion,
        expectedContactVersion: profile.contactVersion,
        expectedMembershipVersion: profile.membershipVersion,
        operationId: crypto.randomUUID(),
      });
      if (!result.ok) {
        setMessage(result.error.message);
        setMessageTone("error");
        return;
      }
      setProfile((current) => ({
        ...current,
        membershipVersion: result.data.membership_version,
        profileVersion: result.data.profile_version,
        contactVersion: result.data.contact_version,
      }));
      setMessage("Your profile is saved.");
      setMessageTone("success");
      router.refresh();
    });
  }

  function saveHandicap() {
    setMessage(null);
    startTransition(async () => {
      const result = await setMemberSelfHandicapAction({
        handicapId,
        handicap,
        asOf: handicapAsOf,
        expectedMembershipVersion: profile.membershipVersion,
        confirmed: handicapConfirmed,
        reason: handicapReason,
        operationId: crypto.randomUUID(),
      });
      if (!result.ok) {
        setMessage(result.error.message);
        setMessageTone("error");
        return;
      }
      setProfile((current) => ({
        ...current,
        membershipVersion: result.data.membership_version,
        handicapRecordId: result.data.handicap_record_id,
        handicapId: result.data.handicap_id,
        handicap: String(result.data.handicap),
        handicapSource: result.data.source,
        handicapAsOf: result.data.as_of,
        handicapCreatedAt: result.data.created_at,
      }));
      setHandicapConfirmed(false);
      setHandicapReason("");
      setMessage("Your handicap is saved.");
      setMessageTone("success");
      router.refresh();
    });
  }

  return (
    <>
      {message ? (
        <p className={`form-message ${messageTone}`} role="status">
          {message}
        </p>
      ) : null}
      <section className="page-section" aria-labelledby="profile-details-title">
        <p className="ledger-kicker">Your details</p>
        <h2 id="profile-details-title">Keep your details up to date</h2>
        <div className="form-stack" aria-busy={pending}>
          <div className="form-row">
            <TextField
              id="member-first-name"
              label="First name"
              value={draft.firstName}
              onChange={(value) => updateDraft("firstName", value)}
              disabled={pending}
              required
            />
            <TextField
              id="member-last-name"
              label="Last name"
              value={draft.lastName}
              onChange={(value) => updateDraft("lastName", value)}
              disabled={pending}
              required
            />
            <TextField
              id="member-spouse-first-name"
              label="Spouse first name"
              value={draft.spouseFirstName ?? ""}
              onChange={(value) =>
                updateDraft("spouseFirstName", value || null)
              }
              disabled={pending}
            />
            <TextField
              id="member-spouse-last-name"
              label="Spouse last name"
              value={draft.spouseLastName ?? ""}
              onChange={(value) => updateDraft("spouseLastName", value || null)}
              disabled={pending}
            />
            <label className="field-group" htmlFor="member-tee-location">
              <span>Preferred tee</span>
              <select
                id="member-tee-location"
                value={draft.teeLocation ?? ""}
                onChange={(event) =>
                  updateDraft(
                    "teeLocation",
                    (event.target.value ||
                      null) as MemberSelfProfileDraft["teeLocation"],
                  )
                }
                disabled={pending}
              >
                <option value="">Choose later</option>
                <option value="pro">Pro</option>
                <option value="back">Back</option>
                <option value="middle">Middle</option>
                <option value="front">Front</option>
              </select>
            </label>
            <TextField
              id="member-secondary-email"
              label="Secondary e-mail"
              type="email"
              value={draft.secondaryEmail ?? ""}
              onChange={(value) => updateDraft("secondaryEmail", value || null)}
              disabled={pending}
            />
            <TextField
              id="member-mobile-phone"
              label="Mobile phone"
              value={draft.mobilePhone ?? ""}
              onChange={(value) => updateDraft("mobilePhone", value || null)}
              disabled={pending}
            />
            <TextField
              id="member-home-phone"
              label="Home phone"
              value={draft.homePhone ?? ""}
              onChange={(value) => updateDraft("homePhone", value || null)}
              disabled={pending}
            />
            <TextField
              id="member-work-phone"
              label="Work phone"
              value={draft.workPhone ?? ""}
              onChange={(value) => updateDraft("workPhone", value || null)}
              disabled={pending}
            />
            <TextField
              id="member-address-line1"
              label="Address line 1"
              value={draft.addressLine1 ?? ""}
              onChange={(value) => updateDraft("addressLine1", value || null)}
              disabled={pending}
            />
            <TextField
              id="member-address-line2"
              label="Address line 2"
              value={draft.addressLine2 ?? ""}
              onChange={(value) => updateDraft("addressLine2", value || null)}
              disabled={pending}
            />
            <TextField
              id="member-city"
              label="City"
              value={draft.city ?? ""}
              onChange={(value) => updateDraft("city", value || null)}
              disabled={pending}
            />
            <TextField
              id="member-state-region"
              label="State or region"
              value={draft.stateRegion ?? ""}
              onChange={(value) => updateDraft("stateRegion", value || null)}
              disabled={pending}
            />
            <TextField
              id="member-postal-code"
              label="Postal code"
              value={draft.postalCode ?? ""}
              onChange={(value) => updateDraft("postalCode", value || null)}
              disabled={pending}
            />
            <TextField
              id="member-country"
              label="Country"
              value={draft.country ?? ""}
              onChange={(value) => updateDraft("country", value || null)}
              disabled={pending}
            />
          </div>
          <fieldset className="member-profile-visibility">
            <legend>Choose what your group sees</legend>
            <CheckField
              id="member-secondary-email-visible"
              label="Show your secondary e-mail to your group"
              checked={draft.secondaryEmailVisible}
              onChange={(value) => updateDraft("secondaryEmailVisible", value)}
              disabled={pending}
            />
            <CheckField
              id="member-mobile-phone-visible"
              label="Show your mobile phone to your group"
              checked={draft.mobilePhoneVisible}
              onChange={(value) => updateDraft("mobilePhoneVisible", value)}
              disabled={pending}
            />
            <CheckField
              id="member-home-phone-visible"
              label="Show your home phone to your group"
              checked={draft.homePhoneVisible}
              onChange={(value) => updateDraft("homePhoneVisible", value)}
              disabled={pending}
            />
            <CheckField
              id="member-work-phone-visible"
              label="Show your work phone to your group"
              checked={draft.workPhoneVisible}
              onChange={(value) => updateDraft("workPhoneVisible", value)}
              disabled={pending}
            />
            <CheckField
              id="member-address-listed"
              label="Show your postal address to your group"
              checked={draft.addressListed}
              onChange={(value) => updateDraft("addressListed", value)}
              disabled={pending}
            />
          </fieldset>
          <button
            className="primary-button"
            type="button"
            onClick={saveProfile}
            disabled={pending}
          >
            {pending ? "Saving your profile…" : "Save your profile"}
          </button>
        </div>
      </section>

      <section className="page-section" aria-labelledby="handicap-title">
        <p className="ledger-kicker">Your handicap</p>
        <h2 id="handicap-title">Update your handicap</h2>
        <div className="form-stack" aria-busy={pending}>
          <div className="form-row">
            <TextField
              id="member-handicap-id"
              label="Handicap ID"
              value={handicapId}
              onChange={setHandicapId}
              disabled={pending}
            />
            <TextField
              id="member-handicap-value"
              label="Handicap"
              value={handicap}
              onChange={setHandicap}
              disabled={pending}
              inputMode="decimal"
              required
            />
            <label className="field-group" htmlFor="member-handicap-as-of">
              <span>Handicap date</span>
              <input
                id="member-handicap-as-of"
                type="date"
                value={handicapAsOf}
                onChange={(event) => setHandicapAsOf(event.target.value)}
                disabled={pending}
                required
              />
            </label>
            <TextField
              id="member-handicap-reason"
              label="Reason for this change"
              value={handicapReason}
              onChange={setHandicapReason}
              disabled={pending}
              required
            />
          </div>
          <CheckField
            id="member-handicap-confirmed"
            label="I confirm this handicap and date are correct"
            checked={handicapConfirmed}
            onChange={setHandicapConfirmed}
            disabled={pending}
          />
          <button
            className="primary-button"
            type="button"
            onClick={saveHandicap}
            disabled={pending}
          >
            {pending ? "Saving your handicap…" : "Save your handicap"}
          </button>
        </div>
      </section>
    </>
  );
}

function TextField({
  id,
  label,
  value,
  onChange,
  disabled,
  required = false,
  type = "text",
  inputMode,
}: Readonly<{
  id: string;
  label: string;
  value: string;
  onChange(value: string): void;
  disabled: boolean;
  required?: boolean;
  type?: "text" | "email";
  inputMode?: "decimal";
}>) {
  return (
    <label className="field-group" htmlFor={id}>
      <span>{label}</span>
      <input
        id={id}
        type={type}
        inputMode={inputMode}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        required={required}
      />
    </label>
  );
}

function CheckField({
  id,
  label,
  checked,
  onChange,
  disabled,
}: Readonly<{
  id: string;
  label: string;
  checked: boolean;
  onChange(value: boolean): void;
  disabled: boolean;
}>) {
  return (
    <label className="checkbox-field" htmlFor={id}>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        disabled={disabled}
      />
      <span>{label}</span>
    </label>
  );
}
