"use client";

import { useEffect, useRef, useState, useTransition } from "react";

import {
  removeBrandingAssetAction,
  uploadBrandingAssetAction,
} from "@/app/actions/clubhouse";
import { SectionHeading } from "@/components/ui";
import type { BrandingAssetSummary } from "@/domain/clubhouse-content";

type BrandingFormProps = Readonly<{
  assets: readonly BrandingAssetSummary[];
}>;

export function BrandingForm({ assets }: BrandingFormProps) {
  const initialAsset = assets.find(
    (asset) => asset.slot === "scoreboard_header" && asset.displayOrder === 0,
  );
  const [slot, setSlot] = useState<"scoreboard_header" | "scoreboard_footer">(
    "scoreboard_header",
  );
  const [assetFile, setAssetFile] = useState<File | null>(null);
  const [altText, setAltText] = useState(initialAsset?.altText ?? "");
  const [decorative, setDecorative] = useState(
    initialAsset?.decorative ?? false,
  );
  const [clickUrl, setClickUrl] = useState(initialAsset?.clickUrl ?? "");
  const [displayOrder, setDisplayOrder] = useState(0);
  const [feedback, setFeedback] = useState("");
  const [pending, startTransition] = useTransition();
  const operationId = useRef<string | null>(null);
  const previewAssetUrlRef = useRef<string | null>(null);
  const [removedAssetIds, setRemovedAssetIds] = useState<ReadonlySet<string>>(
    new Set(),
  );

  const [previewAssetUrl, setPreviewAssetUrl] = useState<string | null>(null);
  const previewClickUrl = secureUrl(clickUrl);
  const currentAsset = assets.find(
    (asset) =>
      !removedAssetIds.has(asset.assetId) &&
      asset.slot === slot &&
      asset.displayOrder === (slot === "scoreboard_header" ? 0 : displayOrder),
  );

  useEffect(() => {
    return () => {
      if (previewAssetUrlRef.current) {
        URL.revokeObjectURL(previewAssetUrlRef.current);
        previewAssetUrlRef.current = null;
      }
    };
  }, []);

  function selectAssetFile(file: File | null) {
    if (previewAssetUrlRef.current) {
      URL.revokeObjectURL(previewAssetUrlRef.current);
    }
    const objectUrl = file ? URL.createObjectURL(file) : null;
    previewAssetUrlRef.current = objectUrl;
    setAssetFile(file);
    setPreviewAssetUrl(objectUrl);
  }

  function clearAssetFile() {
    selectAssetFile(null);
  }

  function selectSlot(nextSlot: typeof slot) {
    setSlot(nextSlot);
    const nextOrder = nextSlot === "scoreboard_header" ? 0 : displayOrder;
    if (nextSlot === "scoreboard_header") setDisplayOrder(0);
    const nextAsset = assets.find(
      (asset) =>
        !removedAssetIds.has(asset.assetId) &&
        asset.slot === nextSlot &&
        asset.displayOrder === nextOrder,
    );
    setAltText(nextAsset?.altText ?? "");
    setDecorative(nextAsset?.decorative ?? false);
    setClickUrl(nextAsset?.clickUrl ?? "");
    clearAssetFile();
  }

  function save() {
    if (!assetFile) {
      setFeedback("Choose a PNG, JPEG, GIF, BMP, or WebP image first.");
      return;
    }
    const normalizedClickUrl = clickUrl.trim() ? secureUrl(clickUrl) : null;
    if (clickUrl.trim() && !normalizedClickUrl) {
      setFeedback("Enter an HTTPS link for people who select this banner.");
      return;
    }
    if (slot === "scoreboard_footer" && displayOrder > 2) {
      setFeedback("Choose a position from first to third.");
      return;
    }

    operationId.current ??= crypto.randomUUID();
    const formData = new FormData();
    formData.set("assetId", currentAsset?.assetId ?? "");
    formData.set("slot", slot);
    formData.set("file", assetFile);
    formData.set("altText", decorative ? "" : altText.trim());
    formData.set("decorative", String(decorative));
    formData.set("clickUrl", normalizedClickUrl ?? "");
    formData.set(
      "displayOrder",
      String(slot === "scoreboard_header" ? 0 : displayOrder),
    );
    formData.set("operationId", operationId.current);
    startTransition(async () => {
      const result = await uploadBrandingAssetAction(formData);
      if (!result.ok) {
        setFeedback(result.error.message);
        return;
      }
      operationId.current = null;
      setFeedback("Your banner is saved.");
    });
  }

  function removeCurrentAsset() {
    if (!currentAsset) return;
    operationId.current ??= crypto.randomUUID();
    startTransition(async () => {
      const result = await removeBrandingAssetAction({
        assetId: currentAsset.assetId,
        operationId: operationId.current,
      });
      if (!result.ok) {
        setFeedback(result.error.message);
        return;
      }
      setRemovedAssetIds((previous) =>
        new Set(previous).add(currentAsset.assetId),
      );
      operationId.current = null;
      clearAssetFile();
      setAltText("");
      setDecorative(false);
      setClickUrl("");
      setFeedback("You removed this banner.");
    });
  }

  return (
    <section className="page-section" aria-labelledby="branding-form-title">
      <SectionHeading
        kicker="Scoreboard branding"
        title="Choose your scoreboard banner"
        titleId="branding-form-title"
      />
      <div className="form-stack">
        <label className="field-group" htmlFor="branding-slot">
          <span>Banner location</span>
          <select
            id="branding-slot"
            value={slot}
            onChange={(event) => selectSlot(event.target.value as typeof slot)}
            disabled={pending}
          >
            <option value="scoreboard_header">Scoreboard header</option>
            <option value="scoreboard_footer">Scoreboard footer</option>
          </select>
        </label>
        {slot === "scoreboard_footer" ? (
          <label className="field-group" htmlFor="branding-order">
            <span>Banner position</span>
            <select
              id="branding-order"
              value={displayOrder}
              onChange={(event) => setDisplayOrder(Number(event.target.value))}
              disabled={pending}
            >
              <option value={0}>Show this banner first</option>
              <option value={1}>Show this banner second</option>
              <option value={2}>Show this banner third</option>
            </select>
          </label>
        ) : null}
        <label className="field-group" htmlFor="branding-file">
          <span>Upload image</span>
          <small>PNG, JPEG, GIF, BMP, or WebP up to 1 MB.</small>
          <input
            id="branding-file"
            type="file"
            accept="image/png,image/jpeg,image/gif,image/bmp,image/webp"
            onChange={(event) =>
              selectAssetFile(event.target.files?.[0] ?? null)
            }
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
        <label className="field-group" htmlFor="branding-click-url">
          <span>Link when people select this banner (optional)</span>
          <input
            id="branding-click-url"
            type="url"
            placeholder="https://"
            value={clickUrl}
            onChange={(event) => setClickUrl(event.target.value)}
            disabled={pending}
          />
        </label>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={decorative}
            onChange={(event) => setDecorative(event.target.checked)}
            disabled={pending}
          />{" "}
          <span>This is a decorative image, so it needs no description.</span>
        </label>
        <button
          className="primary-button"
          type="button"
          onClick={save}
          disabled={pending || !assetFile || (!decorative && !altText.trim())}
        >
          {pending ? "Saving…" : "Save branding"}
        </button>
        {currentAsset ? (
          <div className="form-message" role="status">
            Current banner: {currentAsset.altText || "Decorative image"}. Upload
            a new file to replace it, or remove it below.
          </div>
        ) : null}
        {currentAsset ? (
          <button
            className="secondary-button"
            type="button"
            onClick={removeCurrentAsset}
            disabled={pending}
          >
            Remove current banner
          </button>
        ) : null}
        {previewAssetUrl || currentAsset?.assetUrl ? (
          <div
            className="group-branding-preview"
            aria-labelledby="branding-preview-title"
          >
            <p className="ledger-kicker" id="branding-preview-title">
              Your preview
            </p>
            <a
              href={previewClickUrl ?? currentAsset?.clickUrl ?? undefined}
              target={
                previewClickUrl || currentAsset?.clickUrl ? "_blank" : undefined
              }
              rel={
                previewClickUrl || currentAsset?.clickUrl
                  ? "noreferrer"
                  : undefined
              }
            >
              <img
                src={previewAssetUrl ?? currentAsset?.assetUrl ?? ""}
                alt={
                  decorative ? "" : altText.trim() || "Your scoreboard banner"
                }
                className={
                  slot === "scoreboard_header"
                    ? "scoreboard-branding-header"
                    : "scoreboard-branding-footer"
                }
              />
            </a>
          </div>
        ) : null}
        <p className="form-message" role="status">
          {feedback}
        </p>
      </div>
    </section>
  );
}

function secureUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}
