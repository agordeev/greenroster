import type { Metadata } from "next";
import Link from "next/link";

import { ExampleRoundTable } from "../example-round";
import { Figure, GuideArticle } from "../guide-article";
import { calculatorPath } from "../guides";

const path = "/guides/quota-game-rules";

export const metadata: Metadata = {
  title: "Quota game rules: how a golf quota game works · GreenRoster",
  description:
    "In a quota game you play against your own target. See how points, quotas and plus/minus decide the winner, with a worked example.",
  alternates: { canonical: path },
};

export default function QuotaGameRulesPage() {
  return (
    <GuideArticle path={path}>
      <p>
        In a quota game you play against your own target, not against the other
        golfers’ scores. You have a quota: the points you are expected to score.
        You earn points on every hole, add them up, and take away your quota.
        What is left is your plus/minus, and the best plus/minus wins the round.
      </p>
      <p>
        Because each player chases a different target, a golfer who scores few
        points can beat one who scores many. That is what lets a mixed group
        play one game together.
      </p>

      <h2>A worked example</h2>
      <p>
        These numbers are an example. Four golfers play, each with a different
        quota.
      </p>
      <ExampleRoundTable />
      <p>
        Player B has a quota of <Figure>24</Figure> and scores{" "}
        <Figure>27</Figure> points, so finishes at <Figure>+3</Figure>. Player D
        scores only <Figure>16</Figure> points, the fewest in the group, but
        beats a quota of <Figure>12</Figure> by four. Player D wins the round at{" "}
        <Figure>+4</Figure>.
      </p>

      <h2>The rules your group sets</h2>
      <p>
        The idea is the same everywhere, but the details vary from group to
        group. Agree these before you play, and write them down.
      </p>

      <h3>How you earn points</h3>
      <p>
        Your group decides how many points each hole score is worth. There is no
        single scale every group uses, so settle yours first and keep it the
        same from round to round. Quotas only stay fair if the points behind
        them are counted the same way every time.
      </p>

      <h3>Best plus/minus or most points</h3>
      <p>
        You can rank a round two ways. By plus/minus, the golfer who beats their
        quota by the most wins. By points, the golfer with the most points wins
        and quotas play no part. In the example above, Player D wins on
        plus/minus and Player A, with <Figure>31</Figure> points, wins on
        points.
      </p>

      <h3>Ties</h3>
      <p>
        Two golfers can finish on the same plus/minus. GreenRoster shows them as
        tied for the place. If your group wants a tie-break, agree it before the
        round, not after.
      </p>

      <h3>How quotas change</h3>
      <p>
        A quota follows your form. After each round it is worked out again from
        your recent points totals, so a run of good rounds raises it and a run
        of poor ones lowers it. Groups differ in how many rounds they count; see{" "}
        <Link href="/guides/how-to-calculate-a-golf-quota">
          how to calculate a golf quota
        </Link>
        .
      </p>
      <p>
        Have your recent points totals to hand?{" "}
        <Link href={calculatorPath}>Work out your quota</Link> with the free
        calculator.
      </p>

      <h3>New players and guests</h3>
      <p>
        A new player has no rounds to average, so give them a starting quota the
        group agrees is fair. They keep it until they have played enough rounds.
        A guest playing a single round needs a quota for that day too.
      </p>

      <h3>Prizes</h3>
      <p>
        What the winner gets is up to your group. Customs differ, so agree the
        stakes and how they are shared before the first tee shot.
      </p>
    </GuideArticle>
  );
}
