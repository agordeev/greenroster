import type { MetadataRoute } from "next";

import { calculatorPath, guides } from "@/app/(marketing)/guides/guides";
import { webRuntimeEnv } from "@/lib/runtime-env";

// Only pages a visitor can read without an account. Nothing behind sign-in is
// listed here.
const publicPaths = [
  calculatorPath,
  "/guides",
  ...guides.map((guide) => guide.path),
  "/help",
  "/support",
  "/privacy",
  "/terms",
];

export default function sitemap(): MetadataRoute.Sitemap {
  return publicPaths.map((path) => ({
    url: new URL(path, webRuntimeEnv.appUrl).toString(),
  }));
}
