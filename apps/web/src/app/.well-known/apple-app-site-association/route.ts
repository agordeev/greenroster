import { createAppleAppSiteAssociation } from "../../../lib/app-link-associations";

export function GET() {
  const association = createAppleAppSiteAssociation(process.env);
  return Response.json(association, {
    headers: { "Cache-Control": "public, max-age=3600" },
  });
}
