export const calculatorPath = "/tools/quota-calculator";

// One entry per guide: the search question it answers and where it lives. The
// guides index, each guide's links to the others, and the sitemap read this.
export const guides = [
  {
    path: "/guides/quota-game-rules",
    name: "Quota game rules",
    question: "How does a quota game work?",
    summary:
      "What a quota is, how plus/minus decides the winner, and the rules your group sets for itself.",
  },
  {
    path: "/guides/how-to-calculate-a-golf-quota",
    name: "How to calculate a golf quota",
    question: "How do you work out a player's quota?",
    summary:
      "Two ways to turn a player's recent point totals into a quota, each with a worked example.",
  },
  {
    path: "/guides/how-to-run-a-golf-points-game",
    name: "How to run a golf points game",
    question: "How do you run a regular points game for your group?",
    summary:
      "The seven jobs an organizer does, from agreeing the rules to keeping the season's standings.",
  },
] as const;

export type GuidePath = (typeof guides)[number]["path"];
