import { createAppLinkAssociations } from "../../../lib/app-link-associations";

export function GET() {
  const associations = createAppLinkAssociations(process.env);
  return Response.json([associations.android], {
    headers: { "Cache-Control": "public, max-age=3600" },
  });
}
