"use client";

import { useState, type FormEvent } from "react";

type GroupActivityFilterProps = Readonly<{
  targetType?: string;
  targetId?: string;
}>;

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function GroupActivityFilterForm({
  targetType: initialTargetType,
  targetId: initialTargetId,
}: GroupActivityFilterProps) {
  const [targetType, setTargetType] = useState(initialTargetType ?? "");
  const [targetId, setTargetId] = useState(initialTargetId ?? "");
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    const normalizedType = targetType.trim();
    const normalizedId = targetId.trim();

    if (!normalizedType && normalizedId) {
      event.preventDefault();
      setError("Choose an entity type before entering an entity ID.");
      return;
    }
    if (normalizedType && !normalizedId) {
      event.preventDefault();
      setError("Enter the UUID for the selected entity.");
      return;
    }
    if (normalizedType && !uuidPattern.test(normalizedId)) {
      event.preventDefault();
      setError("Enter a valid entity UUID, then apply the filter again.");
      return;
    }

    setError(null);
  }

  return (
    <form
      className="group-activity-filter"
      method="get"
      onSubmit={handleSubmit}
    >
      <div className="field-group">
        <label htmlFor="activity-target-type">Entity type</label>
        <select
          id="activity-target-type"
          name="target_type"
          value={targetType}
          onChange={(event) => {
            const nextTargetType = event.target.value;
            setTargetType(nextTargetType);
            if (!nextTargetType) setTargetId("");
            setError(null);
          }}
          aria-invalid={error ? "true" : undefined}
          aria-describedby={error ? "activity-filter-error" : undefined}
        >
          <option value="">All entities</option>
          <option value="membership">Member</option>
          <option value="round">Round</option>
        </select>
      </div>
      <div className="field-group">
        <label htmlFor="activity-target-id">Entity ID</label>
        <input
          id="activity-target-id"
          name="target_id"
          value={targetId}
          onChange={(event) => {
            setTargetId(event.target.value);
            setError(null);
          }}
          placeholder="UUID"
          inputMode="text"
          aria-invalid={error ? "true" : undefined}
          aria-describedby={error ? "activity-filter-error" : undefined}
        />
      </div>
      <button className="secondary-button" type="submit">
        Apply filter
      </button>
      {targetType ? (
        <a className="secondary-link" href="/portal/group">
          Clear filter
        </a>
      ) : null}
      {error ? (
        <p
          className="group-filter-error"
          id="activity-filter-error"
          role="alert"
        >
          {error}
        </p>
      ) : null}
    </form>
  );
}
