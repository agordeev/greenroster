import type { Metadata } from "next";

import {
  executeReadPublicScoreboard,
  type PublicScoreboardPlayer,
} from "@/lib/scoreboard/scoreboard-access-data";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Live scores · GreenRoster",
  description: "You see live golf scores and standings.",
};

export default async function ScoreboardPage({
  params,
}: Readonly<{
  params: Promise<{ token: string }>;
}>) {
  const { token } = await params;
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
      <a className="skip-link" href="#main-content">
        Skip to live scores
      </a>
      <main
        id="main-content"
        tabIndex={-1}
        className="auth-shell auth-shell-single invitation-shell"
      >
        <section
          className="auth-ledger member-results-page"
          aria-labelledby="scoreboard-title"
        >
          <p className="ledger-kicker">Live scores</p>
          <h1 id="scoreboard-title">{scoreboard.groupName}</h1>
          <p className="member-results-intro">
            {scoreboard.roundDescription ?? "Live round"} · You see{" "}
            {rankingLabel.toLowerCase()}.
          </p>
          <p className="member-results-format-note">
            You see the latest scores as of{" "}
            {formatTimestamp(scoreboard.lastUpdatedAt)}.
          </p>
          {scoreboard.players.length === 0 ? (
            <section className="member-home-empty" aria-live="polite">
              <h2>You see no players yet.</h2>
              <p>You see players here after they join this round.</p>
            </section>
          ) : (
            <ScoreboardTable
              rankingLabel={rankingLabel}
              players={scoreboard.players}
            />
          )}
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
      <a className="skip-link" href="#main-content">
        Skip to live scores
      </a>
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
            You can’t view this round right now.
          </h1>
          <p>Ask the coordinator for a current link.</p>
        </section>
      </main>
    </>
  );
}
