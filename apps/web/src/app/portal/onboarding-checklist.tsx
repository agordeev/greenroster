import { cn } from "cn";
import { CircleCheckIcon, CircleDashedIcon } from "lucide-react";

import type { OnboardingChecklistItem } from "@/lib/groups/onboarding-checklist";
import { TextLink } from "@/components/blocks";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const taskHref: Record<OnboardingChecklistItem["key"], string> = {
  "group-profile": "/portal/group",
  rules: "/portal/quota",
  members: "/portal/members/new",
  "first-round": "/portal/rounds?new=1",
};

export function OnboardingChecklist({
  items,
  className,
}: Readonly<{
  items: readonly OnboardingChecklistItem[];
  className?: string;
}>) {
  const completedCount = items.filter(
    (item) => item.status === "complete",
  ).length;

  return (
    <Card
      className={className}
      role="region"
      aria-labelledby="onboarding-title"
    >
      <CardHeader>
        <CardTitle>
          <h2 id="onboarding-title">Finish setting up the group</h2>
        </CardTitle>
        <CardDescription>
          <span
            aria-label={`${completedCount} of ${items.length} tasks complete`}
          >
            {completedCount}/{items.length} complete
          </span>
        </CardDescription>
        {/* One segment per task, filled in the order the tasks are listed. */}
        <div className="mt-2 flex gap-1" aria-hidden="true">
          {items.map((item) => (
            <span
              key={item.key}
              className={cn(
                "h-1.5 flex-1 rounded-full",
                item.status === "complete" ? "bg-flag" : "bg-foreground/10",
              )}
            />
          ))}
        </div>
      </CardHeader>
      <CardContent>
        <ol className="m-0 grid list-none divide-y p-0">
          {items.map((item) => (
            <li
              key={item.key}
              className="grid grid-cols-[1.25rem_minmax(0,1fr)] items-start gap-3 py-3 first:pt-0 last:pb-0"
            >
              {item.status === "complete" ? (
                <CircleCheckIcon
                  className="mt-px size-5 text-primary"
                  aria-hidden="true"
                />
              ) : (
                <CircleDashedIcon
                  className="mt-px size-5 text-muted-foreground"
                  aria-hidden="true"
                />
              )}
              <div>
                {item.status === "complete" ? (
                  <span className="font-medium text-muted-foreground">
                    {item.label}
                  </span>
                ) : (
                  <TextLink href={taskHref[item.key]}>{item.label}</TextLink>
                )}
                <span className="sr-only">
                  {item.status === "complete" ? " — Complete" : " — To do"}
                </span>
                <p className="m-0 mt-1 text-[0.8125rem] leading-normal text-muted-foreground">
                  {item.detail}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
