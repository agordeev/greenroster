import type { Metadata } from "next";
import Link from "next/link";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { ExampleRoundTable, exampleRound, signed } from "../example-round";
import { Figure, GuideArticle } from "../guide-article";
import { calculatorPath } from "../guides";

const path = "/guides/how-to-run-a-golf-points-game";

export const metadata: Metadata = {
  title: "How to run a golf points game for your group · GreenRoster",
  description:
    "The seven jobs an organizer does to run a regular golf points game: rules, quotas, rounds, results and season standings.",
  alternates: { canonical: path },
};

// Example season points: one for playing, then three, two and one for the top
// three places. A group sets its own values.
const playingPoints = 1;
const placePoints = [3, 2, 1];
const exampleStandings = [...exampleRound]
  .sort(
    (left, right) => right.points - right.quota - (left.points - left.quota),
  )
  .map((row, index) => ({
    ...row,
    place: index + 1,
    seasonPoints: playingPoints + (placePoints[index] ?? 0),
  }));

export default function HowToRunAGolfPointsGamePage() {
  return (
    <GuideArticle path={path}>
      <p>
        To run a regular points game you do seven jobs: agree how points are
        earned, give every golfer a quota, decide how quotas change, set up each
        round, record the points, share the result, and keep the season’s
        standings. Do them the same way every time and nobody has to argue about
        the numbers.
      </p>

      <h2>The seven jobs</h2>
      <ol>
        <li>
          <strong>Agree how points are earned.</strong> Your group decides how
          many points each hole score is worth. Write the scale down and keep it
          the same from round to round.
        </li>
        <li>
          <strong>Give every golfer a quota.</strong> A quota is the points a
          golfer is expected to score. If you have their recent points totals,{" "}
          <Link href={calculatorPath}>work out a quota in the calculator</Link>.
          If you don’t, agree a starting quota.
        </li>
        <li>
          <strong>Decide how quotas change.</strong> Pick one way to update
          quotas after each round and use it for everyone. See{" "}
          <Link href="/guides/how-to-calculate-a-golf-quota">
            how to calculate a golf quota
          </Link>
          .
        </li>
        <li>
          <strong>Set up the round.</strong> Tell your members the date, time
          and course, and ask who is playing. Know your numbers before you book
          tee times.
        </li>
        <li>
          <strong>Record the points.</strong> After the round, write down each
          golfer’s points total. Take away their quota to get their plus/minus.
        </li>
        <li>
          <strong>Share the result.</strong> Rank the golfers and tell the group
          who won, the same day if you can. Then update the quotas so they are
          ready for next time.
        </li>
        <li>
          <strong>Keep the season’s standings.</strong> Award season points
          after every round and add them up, so the game is about more than one
          day.
        </li>
      </ol>

      <h2>A worked example</h2>
      <p>
        These numbers are an example. Four golfers play, and you record their
        points.
      </p>
      <ExampleRoundTable />
      <p>
        Player D wins at{" "}
        <Figure>
          {signed(exampleRound[3].points - exampleRound[3].quota)}
        </Figure>
        . Say your group gives <Figure>{playingPoints}</Figure> season point for
        playing, plus <Figure>{placePoints.join(", ")}</Figure> for the top
        three places. After this round the season’s standings read:
      </p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead scope="col">Place</TableHead>
            <TableHead scope="col">Player</TableHead>
            <TableHead scope="col" className="text-right">
              Plus/minus
            </TableHead>
            <TableHead scope="col" className="text-right">
              Season points
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {exampleStandings.map((row) => (
            <TableRow key={row.player}>
              <TableCell className="font-mono">{row.place}</TableCell>
              <TableCell>{row.player}</TableCell>
              <TableCell className="text-right font-mono">
                {signed(row.points - row.quota)}
              </TableCell>
              <TableCell className="text-right font-mono font-medium">
                {row.seasonPoints}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <h2>What groups do differently</h2>

      <h3>Who wins the round</h3>
      <p>
        You can rank a round by plus/minus, so every golfer plays against their
        own quota, or by points, so the highest total wins. Tell your members
        which one before they tee off. See the{" "}
        <Link href="/guides/quota-game-rules">quota game rules</Link>.
      </p>

      <h3>Season points</h3>
      <p>
        Some groups reward turning up, some reward placing, and some do both.
        The values in the example are only an example. GreenRoster calls the
        season’s ranking the Order of Merit, and you set how its points are
        awarded.
      </p>

      <h3>Guests</h3>
      <p>
        A guest can play a single round with a quota for the day. In GreenRoster
        a guest’s round stays out of the season’s standings.
      </p>

      <h3>Prizes</h3>
      <p>
        What golfers play for is up to your group. Customs differ, so agree the
        stakes and how they are shared before the season starts.
      </p>
    </GuideArticle>
  );
}
