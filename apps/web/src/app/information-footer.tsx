import Link from "next/link";

export function InformationFooter() {
  return (
    <footer
      className="mx-auto mt-6 mb-0 p-5 border-t max-w-288 flex flex-wrap justify-center gap-y-3 gap-x-6 [&_a]:text-muted-foreground [&_a]:text-[0.8125rem] [&_a]:underline-offset-[0.25rem]"
      data-slot="information-footer"
    >
      <Link href="/help">Help</Link>
      <Link href="/support">Contact support</Link>
      <Link href="/feedback">Send feedback</Link>
      <Link href="/privacy">Privacy Policy</Link>
      <Link href="/terms">Terms of Use</Link>
    </footer>
  );
}
