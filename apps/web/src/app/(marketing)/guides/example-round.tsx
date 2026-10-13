import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

// One made-up round, used by the guides so their examples agree.
export const exampleRound = [
  { player: "Player A", quota: 30, points: 31 },
  { player: "Player B", quota: 24, points: 27 },
  { player: "Player C", quota: 18, points: 17 },
  { player: "Player D", quota: 12, points: 16 },
] as const;

export function signed(value: number): string {
  return value > 0 ? `+${value}` : value < 0 ? `−${-value}` : "0";
}

export function ExampleRoundTable() {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead scope="col">Player</TableHead>
          <TableHead scope="col" className="text-right">
            Quota
          </TableHead>
          <TableHead scope="col" className="text-right">
            Points
          </TableHead>
          <TableHead scope="col" className="text-right">
            Plus/minus
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {exampleRound.map((row) => (
          <TableRow key={row.player}>
            <TableCell>{row.player}</TableCell>
            <TableCell className="text-right font-mono">{row.quota}</TableCell>
            <TableCell className="text-right font-mono">{row.points}</TableCell>
            <TableCell className="text-right font-mono font-medium">
              {signed(row.points - row.quota)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
