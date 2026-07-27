import { createAndroidAssetLinksAssociation } from "../../../lib/app-link-associations";

export function GET() {
  const association = createAndroidAssetLinksAssociation(process.env);
  return Response.json([association], {
    headers: { "Cache-Control": "public, max-age=3600" },
  });
}
