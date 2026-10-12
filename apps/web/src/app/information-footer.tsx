import Link from "next/link";

export function InformationFooter() {
  return (
    <footer className="information-footer">
      <Link href="/help">Help</Link>
      <Link href="/support">Contact support</Link>
      <Link href="/feedback">Send feedback</Link>
      <Link href="/privacy">Privacy Policy</Link>
      <Link href="/terms">Terms of Use</Link>
    </footer>
  );
}
