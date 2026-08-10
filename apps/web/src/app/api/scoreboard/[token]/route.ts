import { executeReadPublicScoreboard } from "@/lib/scoreboard/scoreboard-access-data";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: Readonly<{ params: Promise<{ token: string }> }>,
) {
  const { token } = await context.params;
  try {
    const scoreboard = await executeReadPublicScoreboard(token);
    if (!scoreboard) {
      return Response.json({ error: "unavailable" }, { status: 404 });
    }
    return Response.json(scoreboard, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return Response.json({ error: "unavailable" }, { status: 404 });
  }
}
