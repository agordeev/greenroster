# AGENTS.md

## User-facing copy

Applies to every string a person reads: labels, buttons, headings, empty states,
errors, toasts, e-mails, push notifications.

### The rule

Every sentence names **who acts** and **what they get**, in second person, present
tense. The subject is the member — never the mechanism, the record, or the system.

Test each string by reading it aloud as a golfer holding a phone. If it describes
how the software is built, rewrite it.

### Never ship

- **Implementation nouns**: identity, entity, record, payload, provider, state,
  session, group access, surface, boundary.
- **Architecture words used as reassurance**: member-safe, person-specific,
  isolated, granular, in priority order, confirmed.
- **Security rationale aimed at the reader.** Don't explain why a message is
  deliberately vague; just be vague.
- **Marketing filler**: seamless, powerful, effortless, streamline, unlock, robust,
  intuitive, comprehensive.
- **Noun-phrase feature bullets** ("Person-specific access keeps every group
  isolated.") and the "X isn't just Y, it's Z" pattern.
- **Invented capabilities or numbers** added to make a sentence read better.

### Before / after (real strings from this repo)

| Don't | Do |
| --- | --- |
| Sign in with your person-specific account to load member-safe Home data. | Sign in to see your rounds and standings. |
| This identity cannot access or create a group until its account e-mail is verified. | Confirm your e-mail address to join or create a group. |
| Confirmed member-safe rounds, official results, and your current quota and standings summary in priority order. | Your next round, recent results, and where you stand. |
| Enter your account e-mail. The response never reveals whether an account exists. | Enter your account e-mail and we'll send you a recovery link. |
| Invitation delivery health | Invitations |

### Vocabulary

Use the words members use: round, result, standings, quota, invitation, member.
Keep product entity names (group, Order of Merit) exactly as the product uses them.
If the right member-facing word for an entity is unclear, ask — don't coin one.

### Process

Copy is a **separate pass**, not a by-product of building the feature. When the
feature works, list every new or changed string on its own, away from the code,
and rewrite each one against the rule above before you report the task done.
