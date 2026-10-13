import type { MetadataRoute } from "next";

import { webRuntimeEnv } from "@/lib/runtime-env";

// App pages are kept out of search by their own `robots` metadata, which a
// crawler can only read if it is allowed to fetch the page.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: "/api/" },
    sitemap: new URL("/sitemap.xml", webRuntimeEnv.appUrl).toString(),
  };
}
