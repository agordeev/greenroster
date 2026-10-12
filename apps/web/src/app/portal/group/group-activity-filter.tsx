"use client";

import { useState, type FormEvent } from "react";

import { Field } from "@/components/blocks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";

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
      setError("Choose Member or Round before you enter an ID.");
      return;
    }
    if (normalizedType && !normalizedId) {
      event.preventDefault();
      setError("Enter the ID of the member or round.");
      return;
    }
    if (normalizedType && !uuidPattern.test(normalizedId)) {
      event.preventDefault();
      setError("That ID doesn't look right. Check it and try again.");
      return;
    }

    setError(null);
  }

  return (
    <form
      className="mt-6 p-4 gap-3 border border-border/50 grid grid-cols-[minmax(10rem,0.7fr)_minmax(15rem,1.3fr)_auto_auto] items-end bg-muted max-[720px]:grid-cols-[1fr] [&_[data-slot=text-link]]:mb-[0.7rem] max-[720px]:[&_[data-slot=text-link]]:mb-0!"
      method="get"
      onSubmit={handleSubmit}
    >
      <Field id="activity-target-type" label="What changed">
        <NativeSelect
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
          <option value="">All changes</option>
          <option value="membership">Member</option>
          <option value="round">Round</option>
        </NativeSelect>
      </Field>
      <Field id="activity-target-id" label="ID">
        <Input
          id="activity-target-id"
          name="target_id"
          value={targetId}
          onChange={(event) => {
            setTargetId(event.target.value);
            setError(null);
          }}
          placeholder="Paste the ID"
          inputMode="text"
          aria-invalid={error ? "true" : undefined}
          aria-describedby={error ? "activity-filter-error" : undefined}
        />
      </Field>
      <Button variant="outline" type="submit">
        Apply filter
      </Button>
      {targetType ? (
        <a
          className="justify-self-start text-primary text-[0.875rem] font-bold underline-offset-[0.2em] focus-visible:outline-[3px] focus-visible:outline-solid focus-visible:outline-ring focus-visible:outline-offset-[3px]"
          data-slot="text-link"
          href="/portal/group"
        >
          Clear filter
        </a>
      ) : null}
      {error ? (
        <p
          className="m-0 col-span-full text-destructive text-[0.8125rem]"
          id="activity-filter-error"
          role="alert"
        >
          {error}
        </p>
      ) : null}
    </form>
  );
}
