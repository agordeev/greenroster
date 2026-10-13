import { ChevronRightIcon } from "lucide-react";
import Link from "next/link";

import { Card } from "@/components/ui/card";

import { guides, type GuidePath } from "./guides";

// The guides as one ruled card, each row a link. `except` leaves out the guide
// the reader is already on.
export function GuideLinks({ except }: Readonly<{ except?: GuidePath }>) {
  return (
    <Card className="mt-4 gap-0 divide-y py-0">
      {guides
        .filter((guide) => guide.path !== except)
        .map((guide) => (
          <Link
            key={guide.path}
            className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 p-4 text-inherit no-underline outline-none hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring focus-visible:ring-inset"
            href={guide.path}
          >
            <span className="font-heading text-[1.0625rem] leading-snug font-semibold">
              {guide.name}
            </span>
            <ChevronRightIcon
              className="row-span-2 size-4 text-muted-foreground"
              aria-hidden="true"
            />
            <span className="text-sm leading-[1.55] text-muted-foreground">
              {guide.summary}
            </span>
          </Link>
        ))}
    </Card>
  );
}
