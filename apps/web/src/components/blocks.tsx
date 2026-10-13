import { Children } from "react";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "cn";
import Link from "next/link";

import { Alert } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
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
      data-slot="field-help"
      className={cn(fieldTextClass, "text-muted-foreground", className)}
      {...props}
    />
  );
}

export function FieldError({ className, ...props }: ComponentProps<"p">) {
  return (
    <p
      data-slot="field-error"
      className={cn(fieldTextClass, "text-destructive", className)}
      {...props}
    />
  );
}

export function Kicker({ className, ...props }: ComponentProps<"p">) {
  return (
    <p
      data-slot="kicker"
      className={cn(
        "m-0 flex items-center gap-2 font-mono text-[0.6875rem] font-medium tracking-[0.16em] text-primary uppercase before:size-1.5 before:shrink-0 before:bg-flag before:content-['']",
        className,
      )}
      {...props}
    />
  );
}

// The GreenRoster mark: a tee marker with the pin-flag dot. Decorative; the
// wordmark beside it carries the name.
export function BrandMark({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      data-slot="brand-mark"
      aria-hidden="true"
      className={cn(
        "relative grid size-12 shrink-0 place-items-center rounded-lg bg-primary font-heading text-[1.0625rem] font-semibold tracking-[0.02em] text-primary-foreground after:absolute after:top-1 after:right-1 after:size-1.5 after:rounded-full after:bg-flag after:content-['']",
        className,
      )}
      {...props}
    >
      GR
    </span>
  );
}

// The mark with the wordmark and tagline, as it opens every sign-in page.
export function BrandLockup({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="brand-lockup"
      className={cn("flex items-center gap-3.5", className)}
      {...props}
    >
      <BrandMark />
      <div>
        <p className="m-0 font-heading text-[1.25rem] leading-tight font-semibold">
          GreenRoster
        </p>
        <p className="mx-0 mt-0.5 mb-0 text-[0.8125rem] text-muted-foreground">
          Your group. Your rounds. One roster.
        </p>
      </div>
    </div>
  );
}

// The single panel a sign-up, recovery or invitation page sits in. On phones
// it fills the screen from the top edge.
export function AuthPanel({
  titleId,
  children,
}: Readonly<{ titleId: string; children: ReactNode }>) {
  return (
    <>
      <SkipLink />
      <main
        id="main-content"
        tabIndex={-1}
        className="grid min-h-screen place-items-center p-8 max-[480px]:place-items-stretch max-[480px]:p-0"
      >
        <section
          data-slot="auth-ledger"
          aria-labelledby={titleId}
          className="flex w-full max-w-152 animate-in flex-col rounded-xl border-t-[3px] border-t-primary bg-card p-[clamp(1.5rem,5vw,3.5rem)] ring-1 ring-foreground/10 duration-500 fade-in slide-in-from-bottom-2 max-[480px]:min-h-screen max-[480px]:rounded-none max-[480px]:p-6 max-[480px]:ring-0 max-[480px]:[&_form_button[type=submit]]:w-full [&>[data-slot=text-link]]:mt-5"
        >
          <BrandLockup className="mb-10" />
          {children}
        </section>
      </main>
    </>
  );
}

// Long-form text on help and legal pages.
export function Prose({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="prose"
      className={cn(
        "max-w-168 leading-[1.65] text-foreground/85 [&_h2]:mx-0 [&_h2]:mt-8 [&_h2]:mb-2 [&_h2]:text-[1.5rem] [&_h2]:font-semibold [&_h2]:text-foreground [&_li]:border-t [&_li]:py-2.5 [&_p_a]:font-semibold [&_p_a]:text-primary [&_p_a]:underline [&_p_a]:decoration-primary/30 [&_p_a]:underline-offset-[0.3em] [&_p_a]:hover:decoration-primary [&_p+p]:mt-4 [&_ul]:m-0 [&_ul]:mt-3 [&_ul]:list-none [&_ul]:border-b [&_ul]:p-0",
        className,
      )}
      {...props}
    />
  );
}

export function TextLink({ className, ...props }: ComponentProps<typeof Link>) {
  return (
    <Link
      data-slot="text-link"
      className={cn(
        "self-start justify-self-start text-[0.875rem] font-semibold text-primary underline decoration-primary/30 decoration-1 underline-offset-[0.3em] transition-colors hover:decoration-primary focus-visible:outline-[3px] focus-visible:outline-offset-[3px] focus-visible:outline-ring focus-visible:outline-solid",
        className,
      )}
      {...props}
    />
  );
}

// The single card a portal page sits in. On phones it fills the screen edge to
// edge instead of floating.
export function PagePanel({
  className,
  ...props
}: ComponentProps<typeof Card>) {
  return (
    <Card
      data-slot="page-panel"
      className={cn(
        "mx-auto mt-6 max-w-288 animate-in gap-0 border-t-[3px] border-t-primary p-[clamp(1.5rem,4vw,3rem)] duration-500 fade-in slide-in-from-bottom-2 max-[480px]:m-0 max-[480px]:min-h-[calc(100vh_-_10rem)] max-[480px]:rounded-none max-[480px]:ring-0",
        className,
      )}
      {...props}
    />
  );
}

export function PageHeader({
  kicker,
  title,
  children,
}: Readonly<{
  kicker?: ReactNode;
  title: ReactNode;
  children?: ReactNode;
}>) {
  return (
    <header data-slot="page-header">
      {kicker ? <Kicker>{kicker}</Kicker> : null}
      <h1 className="mt-3 mb-4 text-[length:clamp(1.875rem,3.4vw,2.75rem)] leading-[1.08] font-semibold tracking-[-0.015em]">
        {title}
      </h1>
      {children ? (
        <p className="m-0 max-w-168 text-base leading-[1.65] text-muted-foreground">
          {children}
        </p>
      ) : null}
    </header>
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
      className="mt-6 mb-0 rounded-lg border border-dashed border-input bg-muted/50 p-4 leading-[1.55] text-muted-foreground"
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
  error:
    "border-destructive/40 border-l-destructive bg-destructive/5 text-destructive",
  success: "border-border border-l-primary bg-accent/60 text-foreground",
  info: "border-border border-l-input bg-muted text-muted-foreground",
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
  const blank = Children.toArray(children).every((child) => child === "");

  // Kept out of `Alert` when blank: its box styles would leave an empty row
  // in the form.
  if (blank) {
    return <div data-tone={tone} className="sr-only" {...props} />;
  }

  return (
    <Alert
      role={undefined}
      data-tone={tone}
      className={cn(
        "border-l-[3px] px-3 py-2.5 leading-[1.45] [&_a]:font-bold [&_a]:underline [&_a]:underline-offset-[0.2em]",
        messageToneClass[tone],
        className,
      )}
      {...props}
    >
      {children}
    </Alert>
  );
}

export function SkipLink({
  children = "Skip to main content",
}: Readonly<{ children?: ReactNode }>) {
  return (
    <a
      href="#main-content"
      className="fixed top-3 left-3 z-20 -translate-y-[200%] rounded-md bg-primary px-4 py-3 font-semibold text-primary-foreground focus:translate-y-0"
    >
      {children}
    </a>
  );
}

const panelSurfaceClass =
  "animate-in rounded-xl border-t-[3px] border-t-primary bg-card ring-1 ring-foreground/10 duration-500 fade-in slide-in-from-bottom-2 max-[480px]:rounded-none max-[480px]:ring-0";

const panelTitleClass =
  "[&_h1]:mx-0 [&_h1]:mt-3 [&_h1]:mb-4 [&_h1]:text-[length:clamp(1.875rem,3.4vw,2.75rem)] [&_h1]:leading-[1.08] [&_h1]:font-semibold [&_h1]:tracking-[-0.015em]";

// The panel a portal list or detail page sits in, for pages that write their
// own `<section>`. It sets the page title, the ruled `h2` sections and the
// lead paragraph, so those need no classes.
export const portalPanelClass = cn(
  panelSurfaceClass,
  panelTitleClass,
  "mx-auto mt-6 mb-0 max-w-288 p-[clamp(1.5rem,4vw,3rem)] max-[480px]:m-0 max-[480px]:min-h-[calc(100vh_-_10rem)] [&_[data-slot='action-row']]:mt-8! [&_form:where([data-slot=form-stack],[data-slot=quota-settings-form])]:max-w-184 [&>h2]:mx-0 [&>h2]:mt-12! [&>h2]:mb-3 [&>h2]:border-t [&>h2]:pt-8 [&>h2]:text-[1.5rem] [&>h2]:font-semibold [&>h2+p]:m-0 [&>h2+p]:leading-[1.55] [&>h2+p]:text-muted-foreground [&>p:not([data-slot=kicker])]:max-w-168 [&>p:not([data-slot=kicker])]:leading-[1.65] [&>p:not([data-slot=kicker])]:text-muted-foreground [&>p[role='alert']]:mx-0 [&>p[role='alert']]:mt-6 [&>p[role='alert']]:mb-0 [&>p[role='alert']]:rounded-lg [&>p[role='alert']]:border-l-[3px] [&>p[role='alert']]:border-l-destructive [&>p[role='alert']]:bg-destructive/5 [&>p[role='alert']]:px-3 [&>p[role='alert']]:py-2.5 [&>p[role='alert']]:leading-[1.5]! [&>p[role='alert']]:text-destructive!",
);

// A member or account page with no portal header: one centred panel on the
// canvas. Put `standalonePageClass` on `main` and `standalonePanelClass` on the
// `section` inside it. The wide page is for lists; the full panel for tables.
export const standalonePageClass =
  "grid min-h-screen place-items-center p-8 max-[480px]:place-items-stretch max-[480px]:p-0";

export const standalonePageWideClass = cn(
  standalonePageClass,
  "[--panel-width:52rem]",
);

export const standalonePanelClass = cn(
  panelSurfaceClass,
  panelTitleClass,
  "flex w-full max-w-(--panel-width,38rem) flex-col p-[clamp(1.5rem,5vw,3.5rem)] max-[480px]:min-h-screen max-[480px]:max-w-none max-[480px]:p-6 [&>[data-slot=text-link]]:mt-5 [&>[data-slot=text-link]]:inline-block [&>form]:mt-6 [&>p:not([data-slot=kicker])]:m-0 [&>p:not([data-slot=kicker])]:leading-[1.65] [&>p:not([data-slot=kicker])]:text-muted-foreground",
);

export const standalonePanelFullClass = cn(
  standalonePanelClass,
  "[--panel-width:72rem]",
);
