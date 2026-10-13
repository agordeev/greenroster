import Link from "next/link";

const linkClass =
  "rounded-sm py-3 text-[0.8125rem] text-muted-foreground no-underline underline-offset-[0.25rem] outline-none hover:text-foreground hover:underline focus-visible:ring-3 focus-visible:ring-ring";

// Sits on a tinted band, set apart from the page above it, so it reads as the
// end of the page and not as more content. Help links lead; legal links trail.
export function InformationFooter() {
  return (
    <footer
      className="mx-auto mt-12 flex max-w-288 flex-wrap items-center justify-between gap-x-8 gap-y-1 rounded-xl bg-secondary px-6 py-1 max-[640px]:justify-center max-[480px]:mt-8 max-[480px]:rounded-none max-[480px]:border-t max-[480px]:py-2"
      data-slot="information-footer"
    >
      <nav
        className="flex flex-wrap justify-center gap-x-6"
        aria-label="Calculator and guides"
      >
        <Link className={linkClass} href="/tools/quota-calculator">
          Quota calculator
        </Link>
        <Link className={linkClass} href="/guides">
          Guides
        </Link>
      </nav>
      <nav
        className="flex flex-wrap justify-center gap-x-6"
        aria-label="Help and support"
      >
        <Link className={linkClass} href="/help">
          Help
        </Link>
        <Link className={linkClass} href="/support">
          Contact support
        </Link>
        <Link className={linkClass} href="/feedback">
          Send feedback
        </Link>
      </nav>
      <nav className="flex flex-wrap justify-center gap-x-6" aria-label="Legal">
        <Link className={linkClass} href="/privacy">
          Privacy Policy
        </Link>
        <Link className={linkClass} href="/terms">
          Terms of Use
        </Link>
      </nav>
    </footer>
  );
}
