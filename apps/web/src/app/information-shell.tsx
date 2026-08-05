import Link from "next/link";
import type { ReactNode } from "react";

import { InformationFooter } from "@/app/information-footer";

export function InformationShell({
  children,
  kicker,
  title,
}: Readonly<{ children: ReactNode; kicker: string; title: string }>) {
  return (
    <div className="information-shell">
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <header className="information-header">
        <Link className="portal-brand" href="/">
          <span className="brand-mark" aria-hidden="true">
            GR
          </span>
          <span>
            <strong>GreenRoster</strong>
            <small>Your group. Your rounds. One roster.</small>
          </span>
        </Link>
        <Link className="secondary-link" href="/sign-in">
          Sign in
        </Link>
      </header>
      <main id="main-content" tabIndex={-1} className="information-card">
        <p className="ledger-kicker">{kicker}</p>
        <h1>{title}</h1>
        {children}
      </main>
      <InformationFooter />
    </div>
  );
}
