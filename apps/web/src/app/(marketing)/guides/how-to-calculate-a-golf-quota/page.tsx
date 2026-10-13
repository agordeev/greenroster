import type { Metadata } from "next";
import Link from "next/link";

import { calculateQuota } from "@/domain/quota-rules";

import { Figure, GuideArticle } from "../guide-article";
import { calculatorPath } from "../guides";

const path = "/guides/how-to-calculate-a-golf-quota";

export const metadata: Metadata = {
  title: "How to calculate a golf quota · GreenRoster",
  description:
    "A golf quota is an average of your recent points totals. Two ways to work it out, moving average and best 10 of 20, with worked examples.",
  alternates: { canonical: path },
};

// Example totals, oldest first. The quotas shown on the page are worked out
// from them by the same function the app uses, so the text cannot drift.
const twentyRounds = [
  18, 26, 21, 27, 22, 28, 24, 30, 25, 26, 20, 29, 23, 27, 22, 31, 24, 28, 25,
  30,
].map(String);
const latestTen = twentyRounds.slice(-10);

function exampleQuota(input: Parameters<typeof calculateQuota>[0]) {
  const result = calculateQuota(input);
  if (!result.ready) throw new Error("The guide example needs a quota.");
  return result;
}

const movingAverage = exampleQuota({
  eligiblePointTotals: latestTen,
  historyLength: 10,
  method: "moving_average",
  precision: 1,
  useInitialQuota: false,
});
const bestTen = exampleQuota({
  eligiblePointTotals: twentyRounds,
  method: "best_10_of_20",
  precision: 1,
  useInitialQuota: false,
});

const total = (values: readonly string[]) =>
  values.reduce((sum, value) => sum + Number(value), 0);

export default function HowToCalculateAGolfQuotaPage() {
  return (
    <GuideArticle path={path}>
      <p>
        A quota is an average of the points you scored in your recent rounds.
        Add up the points totals that count, divide by how many there are, and
        round the answer. Groups differ in which rounds count. This guide covers
        two ways: a moving average, and the best 10 of your last 20.
      </p>

      <h2>Moving average</h2>
      <p>
        Take your latest rounds and average them. Your group picks how many
        rounds count. GreenRoster starts at ten and lets a group pick any number
        from 4 to 20.
      </p>
      <p>
        An example, counting ten rounds. A golfer’s last ten points totals,
        oldest first, are:
      </p>
      <p>
        <Figure>{latestTen.join(", ")}</Figure>
      </p>
      <p>
        They add up to <Figure>{total(latestTen)}</Figure>. Divide by ten and
        the quota is <Figure>{movingAverage.quota}</Figure>. After the next
        round, the oldest total drops out and the new one comes in.
      </p>
      <p>
        <Link
          href={`${calculatorPath}?method=moving_average&rounds=10&points=${latestTen.join(",")}`}
        >
          Try a moving average in the calculator
        </Link>{" "}
        with these numbers, then swap in your own.
      </p>

      <h2>Best 10 of 20</h2>
      <p>
        Take your latest 20 rounds, keep the ten highest points totals, and
        average those. Your ten weakest rounds are left out, so one bad day does
        not pull your quota down.
      </p>
      <p>
        An example. The same golfer’s last 20 points totals, oldest first, are:
      </p>
      <p>
        <Figure>{twentyRounds.join(", ")}</Figure>
      </p>
      <p>The ten highest are:</p>
      <p>
        <Figure>
          {bestTen.sourcePointTotals.map((value) => Number(value)).join(", ")}
        </Figure>
      </p>
      <p>
        They add up to <Figure>{total(bestTen.sourcePointTotals)}</Figure>.
        Divide by ten and the quota is <Figure>{bestTen.quota}</Figure>. That is
        higher than the <Figure>{movingAverage.quota}</Figure> a moving average
        gives the same golfer, because only the better rounds count.
      </p>
      <p>
        <Link
          href={`${calculatorPath}?method=best_10_of_20&points=${twentyRounds.join(",")}`}
        >
          Try best 10 of 20 in the calculator
        </Link>{" "}
        with these numbers, then swap in your own.
      </p>

      <h2>What groups do differently</h2>

      <h3>Fewer rounds than you need</h3>
      <p>
        A golfer with only a few rounds can still have a quota. Either average
        the rounds they have, or give them a starting quota and keep it until
        they have played enough rounds for the method to take over.
      </p>

      <h3>Starting quota for a new player</h3>
      <p>
        A new player has no points totals yet. Give them a starting quota the
        group agrees is fair, and let their own rounds replace it over time.
      </p>

      <h3>Rounding</h3>
      <p>
        Decide whether quotas are whole numbers or carry one or two decimal
        places, and use the same rule for everyone. In GreenRoster a half rounds
        up: to whole numbers, <Figure>24.5</Figure> becomes <Figure>25</Figure>.
      </p>

      <h3>Which rounds count</h3>
      <p>
        Count only rounds the golfer played and finished with a points total. A
        round that was cancelled, or one they sat out, adds nothing.
      </p>

      <h3>Moving the last quota up or down</h3>
      <p>
        Some groups do not average at all. They take the golfer’s previous quota
        and move it up or down by a set amount, depending on their plus/minus in
        the last round. Your group sets how far the quota moves for each result.
      </p>
    </GuideArticle>
  );
}
