# Writing standard

How Crow writes its docs, task files, PRs, reports, the founder console and every status or alert message. It follows the conventions of technical reports, monitoring dashboards and security reports: the reader learns what happened, how bad it is and what to do next before any background. Rafa set the standard on 2026-11-04.

Write for a reader who is new to the project, a newly promoted product manager for example. They should understand each sentence without asking the author.

## Sentences

- **Use active voice and name the actor.** Write "The operator relays the message", not "The message is relayed". Write "Rafa approved the deploy", not "The deploy was approved".
- **Use the present tense** for how things work, and the past tense, with a date, for what happened: "On 2026-11-03 the demo moved to Sepolia."
- **One idea per sentence,** and about 25 words at most. Use a list for three or more parallel items.
- **Use plain words.** Write "use", not "leverage"; "check", not "validate" (unless you mean schema validation); "about", not "approximately".
- **Define a term at its first use,** or link the glossary in `docs/architecture.md`. Put a plain phrase beside every internal label: "the phase-one cut of appeals and bonds (D57)", not "D57"; "the refunded-buyer key fix (T-206 H-2)", not "H-2".
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

## Numbers that drift

A standing doc says how things work, so it stays true without an edit each time something grows. Rafa set this rule on 2026-11-12.

- **No hand-written count or range of something that grows.** Leave out decision or task ID ranges, counts of tests, rows, files, lines or bytes, and measured run times. Point to the source instead: write "`docs/decisions-today.md` records the decisions", not a range of decision IDs.
- **A value that lives in code or config is a variable.** A cap, a window, a fee or a version is filled in by a build script and compared with its source by a check, as `site/build.mjs` and `site/check.mjs` do for `site/llms.txt`. Where a doc has no such mechanism, name the source file instead of copying the value.
- **Dated records keep their numbers,** with units: decisions and ADRs, `docs/decisions-today.md`, task files, reviews, research, the deploy record lines in `docs/operations.md`, and audit docs pinned to a commit. Each is a measurement at a time.
- **A rough duration may stay as an order of size,** such as "seconds" or "tens of minutes", where it tells an agent to run something in the background.

`tests/design-map.test.ts` fails on the plainest cases in the standing docs: an ID range and a count of tests.

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
