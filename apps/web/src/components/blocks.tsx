import type { ReactNode } from "react";

// The shared building blocks for portal and member pages. Use these instead of
// writing the class names by hand so every page keeps the same structure.

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
    <div className="field-group">
      <label htmlFor={id}>{label}</label>
      {children}
      {help ? <p className="field-help">{help}</p> : null}
      {error ? <p className="field-error">{error}</p> : null}
    </div>
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
    <div className="section-heading">
      <div>
        {kicker ? <p className="ledger-kicker">{kicker}</p> : null}
        <Heading id={titleId}>{title}</Heading>
      </div>
      {meta == null || meta === false ? null : <p>{meta}</p>}
    </div>
  );
}

export function EmptyState({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <p className="empty-state" role="status">
      {children}
    </p>
  );
}

export function ActionRow({ children }: Readonly<{ children: ReactNode }>) {
  return <div className="action-row">{children}</div>;
}
