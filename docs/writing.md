# Writing standard

How Crow writes its docs, task files, PRs, reports, the founder console and every status or alert message. It follows the conventions of technical reports, monitoring dashboards and security reports: the reader learns what happened, how bad it is and what to do next before any background. Rafa set the standard on 2026-11-04.

Write for a reader who is new to the project, a newly promoted product manager for example. They should understand each sentence without asking the author.

## Sentences

- **Use active voice and name the actor.** Write "The operator relays the message", not "The message is relayed". Write "Rafa approved the deploy", not "The deploy was approved".
- **Use the present tense** for how things work, and the past tense, with a date, for what happened: "On 2026-11-03 the demo moved to Sepolia."
- **One idea per sentence,** and about 25 words at most. Use a list for three or more parallel items.
- **Use plain words.** Write "use", not "leverage"; "check", not "validate" (unless you mean schema validation); "about", not "approximately".
- **Define a term at its first use,** or link the glossary in `docs/architecture.md`. Put a plain phrase beside every internal label: "the overturn payout from the decider's bond (D43)", not "D43"; "the refunded-buyer key fix (T-206 H-2)", not "H-2".
- **Avoid:** asides set off by em dashes, "not X but Y" framing, scare quotes, "worth noting", "honest caveat", apologies, exclamation marks, and "please" in interface text.

## Findings, alerts and status lines

Lead with the state, then the facts, then the action, in that order.

1. **State,** from a fixed vocabulary:
   - **Severity** for findings and alerts: Critical, High, Medium, Low, Info.
   - **Component status:** Operational, Degraded, Down, Unknown.
   - **Task status:** the words in `docs/plan.md` (todo, in progress, review, done, blocked).
2. **What happened, where, and since when.** Name the component, file or PR, and the time: "API node 2 has answered 503 since 09:14 UTC."
3. **Impact,** in one sentence: who or what it affects.
4. **Next action and owner:** "Rafa merges PR 159." "The session on T-211, the reference adjudicator's checks, fixes it in its PR."

A complete alert reads: "High · PR 151 touches `.github/CODEOWNERS`, a tier 3 control file (CI and agent rules). Rafa merges those. Open 15 hours."

## Numbers, times and evidence

- **Units every time:** "4.71 tUSDC", "1,636,242 gas", "42 s", "0.03 Sepolia ETH". Money follows the hard rule: base units in data, two decimals with the token in prose.
- **Dates and times:** dates as YYYY-MM-DD; times in UTC in records and logs; the console's header may show local time if it says so.
- **Label each claim** measured, documented, inferred or guessed (`CLAUDE.md`, "How to verify your work"). Put measured numbers next to the command or source that produced them.
- **Link evidence:** a PR, a commit, an Etherscan transaction or a file path, not "see above".

## Reports and reviews

A review, audit or incident report has these parts, in this order:
1. **Summary:** the verdict and the two or three findings that matter, in plain words.
2. **Scope:** what the reviewer examined, at which commit, and what they left out.
3. **Findings by severity,** each with: what is wrong, where, the impact, the evidence, and the fix.
4. **Recommendations and open questions,** each with an owner.

## Interface text (the console and the site)

- **Buttons and links say what happens:** "Lock this tab", "Open the design map".
- **Empty states say what will appear and how:** "No key register yet: copy `keys.template.json` to your cost folder as `keys.json`."
- **Every state has a word and a shape,** never colour alone.
- **Headings are nouns or short noun phrases:** "Waiting on you", "Update flow".

## Checking

Before you hand off, reread your text against this page. A reviewer flags passive voice that hides an actor, internal shorthand without a plain phrase, and numbers without units or labels.
