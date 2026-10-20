import { calculatorPath, guides } from "@/app/(marketing)/guides/guides";

// The public pages (landing, pricing, calculator and guides) whose "Start a group"
// buttons tag sign-up with `?from=`. Anything else in the query string is
// dropped, so the group records only a page we know about.
const pageSlug = (path: string) => path.slice(path.lastIndexOf("/") + 1);

export const landingSignupSource = "home";
export const pricingSignupSource = "pricing";

export const signupSources: readonly string[] = [
  landingSignupSource,
  pricingSignupSource,
  pageSlug(calculatorPath),
  ...guides.map((guide) => pageSlug(guide.path)),
];

export function signupSourceFor(path: string) {
  return pageSlug(path);
}

export function parseSignupSource(value: unknown): string | null {
  return typeof value === "string" && signupSources.includes(value)
    ? value
    : null;
}
