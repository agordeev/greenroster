"use client";

import { useRef, useState, useTransition } from "react";

import { saveBrandingAssetAction } from "@/app/actions/clubhouse";

export function BrandingForm() {
  const [slot, setSlot] = useState<"scoreboard_header" | "scoreboard_footer">(
    "scoreboard_header",
  );
  const [assetUrl, setAssetUrl] = useState("");
  const [altText, setAltText] = useState("");
  const [decorative, setDecorative] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [pending, startTransition] = useTransition();
  const operationId = useRef<string | null>(null);
  function save() {
    operationId.current ??= crypto.randomUUID();
    startTransition(async () => {
      const result = await saveBrandingAssetAction({
        slot,
        assetUrl,
        mimeType: "image/png",
        byteSize: 1,
        altText: decorative ? null : altText,
        decorative,
        displayOrder: 0,
        operationId: operationId.current,
      });
      if (!result.ok) {
        setFeedback(result.error.message);
        return;
      }
      operationId.current = null;
      setFeedback("You saved your scoreboard branding.");
    });
  }
  return (
    <section
      className="group-profile-panel"
      aria-labelledby="branding-form-title"
    >
      <div className="group-panel-heading">
        <div>
          <p className="ledger-kicker">Scoreboard branding</p>
          <h2 id="branding-form-title">Choose your scoreboard banner</h2>
        </div>
      </div>
      <div className="group-profile-form">
        <label className="field-group" htmlFor="branding-slot">
          <span>Banner location</span>
          <select
            id="branding-slot"
            value={slot}
            onChange={(event) => setSlot(event.target.value as typeof slot)}
            disabled={pending}
          >
            <option value="scoreboard_header">Scoreboard header</option>
            <option value="scoreboard_footer">Scoreboard footer</option>
          </select>
        </label>
        <label className="field-group" htmlFor="branding-url">
          <span>Secure image link</span>
          <input
            id="branding-url"
            type="url"
            placeholder="https://"
            value={assetUrl}
            onChange={(event) => setAssetUrl(event.target.value)}
            disabled={pending}
            required
          />
        </label>
        <label className="field-group" htmlFor="branding-alt">
          <span>Describe this image</span>
          <input
            id="branding-alt"
            value={altText}
            onChange={(event) => setAltText(event.target.value)}
            disabled={pending || decorative}
            required={!decorative}
          />
        </label>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={decorative}
            onChange={(event) => setDecorative(event.target.checked)}
            disabled={pending}
          />{" "}
          <span>This image is decorative.</span>
        </label>
        <button
          className="primary-button"
          type="button"
          onClick={save}
          disabled={
            pending || !assetUrl.trim() || (!decorative && !altText.trim())
          }
        >
          {pending ? "Saving…" : "Save branding"}
        </button>
        <p className="form-message" role="status">
          {feedback}
        </p>
      </div>
    </section>
  );
}
