import type { Metadata } from "next";

import {
  executeReadPublicScoreboard,
  type PublicScoreboardPlayer,
} from "@/lib/scoreboard/scoreboard-access-data";
import { SkipLink } from "@/components/blocks";

import { KioskRefresh } from "./kiosk-refresh";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Live scores · GreenRoster",
  description: "Follow live golf scores and standings.",
};

export default async function ScoreboardPage({
  params,
  searchParams,
}: Readonly<{
  params: Promise<{ token: string }>;
  searchParams?: Promise<
    Readonly<Record<string, string | string[] | undefined>>
  >;
}>) {
  const { token } = await params;
  const query = searchParams ? await searchParams : {};
  const kiosk = query.kiosk === "1" || query.kiosk === "true";
  let scoreboard;
  try {
    scoreboard = await executeReadPublicScoreboard(token);
  } catch {
    scoreboard = null;
  }

  if (!scoreboard) return <ScoreboardUnavailable />;

  const rankingLabel =
    scoreboard.roundFormat === "individual_net" ? "Plus/minus" : "Golf points";

  return (
    <>
      <SkipLink>Skip to live scores</SkipLink>
      <main
        id="main-content"
        tabIndex={-1}
        className={`auth-shell auth-shell-single invitation-shell${kiosk ? " scoreboard-kiosk" : ""}`}
      >
        <section
          className="auth-ledger member-results-page"
          aria-labelledby="scoreboard-title"
        >
          <p className="ledger-kicker">Live scores</p>
          <h1 id="scoreboard-title">{scoreboard.groupName}</h1>
          <p className="member-results-intro">
            {scoreboard.roundDescription ?? "Live round"} · Ranked by{" "}
            {rankingLabel.toLowerCase()}.
          </p>
          <p className="member-results-format-note">
            Scores as of {formatTimestamp(scoreboard.lastUpdatedAt)}.
          </p>
          <KioskRefresh enabled={kiosk} />
          {scoreboard.branding.header.map((asset) => (
            <a
              key={`${asset.assetUrl}-${asset.displayOrder}`}
              href={asset.clickUrl ?? undefined}
              target={asset.clickUrl ? "_blank" : undefined}
              rel={asset.clickUrl ? "noreferrer" : undefined}
            >
              <img
                className="scoreboard-branding-header"
                src={asset.assetUrl}
                alt={
                  asset.decorative
                    ? ""
                    : (asset.altText ?? "Group scoreboard banner")
                }
              />
            </a>
          ))}
          {scoreboard.players.length === 0 ? (
            <section className="member-home-empty" aria-live="polite">
              <h2>No players yet.</h2>
              <p>Players appear here after they join this round.</p>
            </section>
          ) : (
            <ScoreboardTable
              rankingLabel={rankingLabel}
              players={scoreboard.players}
            />
          )}
          {scoreboard.branding.footer.map((asset) => (
            <a
              key={`${asset.assetUrl}-${asset.displayOrder}`}
              href={asset.clickUrl ?? undefined}
              target={asset.clickUrl ? "_blank" : undefined}
              rel={asset.clickUrl ? "noreferrer" : undefined}
            >
              <img
                className="scoreboard-branding-footer"
                src={asset.assetUrl}
                alt={
                  asset.decorative
                    ? ""
                    : (asset.altText ?? "Group sponsor banner")
                }
              />
            </a>
          ))}
        </section>
      </main>
    </>
  );
}

function ScoreboardTable({
  rankingLabel,
  players,
}: Readonly<{
  rankingLabel: string;
  players: readonly PublicScoreboardPlayer[];
}>) {
  return (
    <div className="member-results-table-wrap">
      <table className="member-results-table">
        <caption className="visually-hidden">Live scores</caption>
        <thead>
          <tr>
            <th scope="col">Rank</th>
            <th scope="col">Player</th>
            <th scope="col">Points</th>
            <th scope="col">Gross</th>
            <th scope="col">Net</th>
            <th scope="col">{rankingLabel}</th>
          </tr>
        </thead>
        <tbody>
          {players.map((player) => (
            <tr key={player.participantId}>
              <th scope="row">{player.competitionRank ?? "—"}</th>
              <td>
                <strong>{player.playerName}</strong>
                {player.participantKind === "guest" ? (
                  <span className="member-results-guest">Guest</span>
                ) : null}
              </td>
              <td>{player.golfPoints ?? "—"}</td>
              <td>{player.grossScore ?? "—"}</td>
              <td>{player.netScore ?? "—"}</td>
              <td>
                {rankingLabel === "Plus/minus"
                  ? (player.plusMinus ?? "—")
                  : (player.rankingValue ?? "—")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatTimestamp(value: string | null): string {
  if (!value) return "the latest round update";
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(value));
}

function ScoreboardUnavailable() {
  return (
    <>
      <SkipLink>Skip to live scores</SkipLink>
      <main
        id="main-content"
        tabIndex={-1}
        className="auth-shell auth-shell-single invitation-shell"
      >
        <section
          className="auth-ledger"
          aria-labelledby="scoreboard-unavailable-title"
        >
          <p className="ledger-kicker">Live scores</p>
          <h1 id="scoreboard-unavailable-title">
            These live scores aren’t available.
          </h1>
          <p>Ask your group coordinator for a current link.</p>
        </section>
      </main>
    </>
  );
}
