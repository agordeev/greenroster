import type { Metadata } from "next";

import {
  executeReadPublicScoreboard,
  type PublicScoreboardPlayer,
} from "@/lib/scoreboard/scoreboard-access-data";
import {
  Kicker,
  SkipLink,
  standalonePageWideClass,
  standalonePanelClass,
  standalonePanelFullClass,
} from "@/components/blocks";

import { KioskRefresh } from "./kiosk-refresh";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Live scores · GreenRoster",
  description: "Follow live golf scores and standings.",
  robots: { index: false, follow: false },
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
        className={`p-8 min-h-screen grid grid-cols-[minmax(20rem,38rem)] place-content-center max-[800px]:grid-cols-[1fr] max-[480px]:p-0 [&_[data-slot=auth-ledger]]:border [&_[data-slot=auth-ledger]]:min-h-auto [&_[data-slot=auth-ledger]]:w-[min(100%,52rem)] max-[480px]:[&_[data-slot=auth-ledger]]:border-0! max-[480px]:[&_[data-slot=auth-ledger]]:w-full!${kiosk ? " scoreboard-kiosk" : ""}`}
      >
        <section
          className={standalonePanelFullClass}
          data-slot="auth-ledger"
          aria-labelledby="scoreboard-title"
        >
          <Kicker>Live scores</Kicker>
          <h1 id="scoreboard-title">{scoreboard.groupName}</h1>
          <p className="text-muted-foreground leading-[1.55]">
            {scoreboard.roundDescription ?? "Live round"} · Ranked by{" "}
            {rankingLabel.toLowerCase()}.
          </p>
          <p className="mt-2 text-muted-foreground leading-[1.55] text-[0.875rem]">
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
            <section
              className="mt-10 pt-8 border-t [&>p:not([data-slot=kicker])]:text-muted-foreground [&>p:not([data-slot=kicker])]:leading-[1.65] [&_h2]:mx-0 [&_h2]:mt-1.5 [&_h2]:mb-0 [&_h2]:text-[1.5rem] [&_h2]:font-semibold"
              aria-live="polite"
            >
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
    <div className="mt-5 border relative overflow-x-auto bg-card">
      <table className="w-full min-w-192 border-collapse text-left [&_tbody_th]:font-semibold [&_tbody_th]:text-primary! [&_tbody_th]:text-[1.125rem]! [&_tbody_tr:last-child_td]:border-b-0 [&_tbody_tr:last-child_th]:border-b-0 [&_td]:py-[0.9rem] [&_td]:px-3 [&_td]:border-b [&_td]:border-b-border/50 [&_td]:align-top [&_td]:text-[0.8125rem] [&_th]:py-[0.9rem] [&_th]:px-3 [&_th]:border-b [&_th]:border-b-border/50 [&_th]:align-top [&_th]:text-[0.8125rem] [&_thead_th]:text-muted-foreground [&_thead_th]:font-mono [&_thead_th]:text-[0.6875rem] [&_thead_th]:tracking-[0.08em] [&_thead_th]:uppercase">
        <caption className="sr-only">Live scores</caption>
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
                  <span className="mt-1 block text-muted-foreground font-mono text-[0.6875rem] tracking-[0.08em] uppercase">
                    Guest
                  </span>
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
      <main id="main-content" tabIndex={-1} className={standalonePageWideClass}>
        <section
          className={standalonePanelClass}
          data-slot="auth-ledger"
          aria-labelledby="scoreboard-unavailable-title"
        >
          <Kicker>Live scores</Kicker>
          <h1 id="scoreboard-unavailable-title">
            These live scores aren’t available.
          </h1>
          <p>Ask your group coordinator for a current link.</p>
        </section>
      </main>
    </>
  );
}
