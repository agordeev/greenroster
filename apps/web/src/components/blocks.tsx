import type { ComponentProps, ReactNode } from "react";
import { cn } from "cn";

import { Alert } from "@/components/ui/alert";
import { Label } from "@/components/ui/label";

// The shared building blocks for portal and member pages. Use these instead of
// repeating the utility classes so every page keeps the same structure.

export function Field({
  id,
  label,
  error,
  help,
  children,
}: Readonly<{
  id: string;
  label: ReactNode;
  error?: string | undefined;
  help?: ReactNode;
  children: ReactNode;
}>) {
  return (
    <div data-slot="field" className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {help ? <FieldHelp>{help}</FieldHelp> : null}
      {error ? <FieldError>{error}</FieldError> : null}
    </div>
  );
}

const fieldTextClass =
  "m-0 min-h-5 text-[0.8125rem] leading-[1.45] [&_a]:font-bold [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-[0.2em]";

export function FieldHelp({ className, ...props }: ComponentProps<"p">) {
  return (
    <p
      className={cn(fieldTextClass, "text-muted-foreground", className)}
      {...props}
    />
  );
}

export function FieldError({ className, ...props }: ComponentProps<"p">) {
  return (
    <p
      className={cn(fieldTextClass, "text-destructive", className)}
      {...props}
    />
  );
}

export function Kicker({ className, ...props }: ComponentProps<"p">) {
  return (
    <p
      className={cn(
        "m-0 text-xs font-bold tracking-[0.14em] text-primary uppercase",
        className,
      )}
      {...props}
    />
  );
}

export function SectionHeading({
  kicker,
  title,
  titleId,
  meta,
  as: Heading = "h2",
}: Readonly<{
  kicker?: ReactNode;
  title: ReactNode;
  titleId?: string | undefined;
  meta?: ReactNode;
  as?: "h2" | "h3";
}>) {
  return (
    <div
      data-slot="section-heading"
      className="flex items-end justify-between gap-4 max-[720px]:flex-col max-[720px]:items-start"
    >
      <div>
        {kicker ? <Kicker>{kicker}</Kicker> : null}
        <Heading
          id={titleId}
          className={cn(
            "mt-1.5 mb-0 font-semibold",
            Heading === "h2" ? "text-2xl" : "text-lg",
          )}
        >
          {title}
        </Heading>
      </div>
      {meta == null || meta === false ? null : (
        <p className="m-0 text-xs whitespace-nowrap text-muted-foreground">
          {meta}
        </p>
      )}
    </div>
  );
}

export function EmptyState({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <p
      className="mt-6 mb-0 rounded-lg border border-border p-4 leading-[1.55] text-muted-foreground"
      role="status"
    >
      {children}
    </p>
  );
}

export function ActionRow({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <div
      data-slot="action-row"
      className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-3"
    >
      {children}
    </div>
  );
}

const messageToneClass = {
  error: "border-destructive/40 text-destructive",
  success: "border-border text-foreground",
  info: "border-border bg-muted text-muted-foreground",
} as const;

// A form or page message. `role` and `aria-live` pass straight through, so each
// call site keeps the announcement behaviour it had. An empty message stays in
// the page as a hidden live region.
export function FormMessage({
  tone = "error",
  className,
  children,
  ...props
}: ComponentProps<"div"> & { tone?: keyof typeof messageToneClass }) {
  const blank = children == null || children === false || children === "";

  return (
    <Alert
      role={undefined}
      data-tone={tone}
      className={cn(
        blank
          ? "sr-only"
          : [
              "px-3 py-2.5 leading-[1.45] [&_a]:font-bold [&_a]:underline [&_a]:underline-offset-[0.2em]",
              messageToneClass[tone],
            ],
        className,
      )}
      {...props}
    >
      {children}
    </Alert>
  );
}

export function SkipLink() {
  return (
    <a
      href="#main-content"
      className="fixed top-3 left-3 z-20 -translate-y-[200%] rounded-md bg-foreground px-4 py-3 text-background focus:translate-y-0"
    >
      Skip to main content
    </a>
  );
}
