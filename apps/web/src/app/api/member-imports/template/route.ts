import { createMemberCsvTemplate } from "../../../../lib/member-imports/member-csv";

export function GET(): Response {
  return new Response(createMemberCsvTemplate(), {
    headers: {
      "Cache-Control": "private, max-age=300",
      "Content-Disposition": 'attachment; filename="greenroster-members.csv"',
      "Content-Type": "text/csv; charset=utf-8",
    },
  });
}
