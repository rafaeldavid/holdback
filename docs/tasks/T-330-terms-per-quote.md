# T-330: terms set per quote, and the buyer sees how they differ

- **Lane:** api (example code), with two sections of the agent docs
- **Phase:** 2, settlement on EVM (stable EVM operations, D53)
- **Kind:** 4, API and example code (Change recipes): the examples' tests, no review, a target of 150k tokens. One `reviewer` pass on the signer's diff, because it changes what a buyer signs. The `site/llms.txt` edits are kind 1.
- **Depends on:** T-318 (the seller adapter), T-319 and T-325 (the buyer signer), T-324 (the adapter as a service), PR 314 (the signer's quorum fix).
- **Paths this task may touch:** `examples/seller-adapter.ts` (the quote route's terms building, `loadTemplate`, `fill` and the configuration fields this task adds), `examples/seller-adapter.template.json`, `examples/seller-adapter-stub.ts`, `examples/buyer-signer.ts`, `examples/buy-with-signer.ts`, their test files or new test files beside them, `vitest.config.ts` (cost lines for new test files only), `site/llms.txt` (the sections "Sell a priced API service" and "A seller's client can carry the buyer's side" only), `site/index.html` (only as `node site/build.mjs` regenerates it), this file. Never: `packages/`, `apps/`, `spec/schemas/`, `contracts/`, the adapter's result-to-delivery path (T-329).
- **Human gate:** no. The site deploy that publishes the `llms.txt` edits waits for Rafa.
- **Status:** done (PR 316, merged 2026-11-11)
- **Agent/session:** the T-330 session, 2026-11-11, branch `t-330-terms-per-quote`
- **Roadmap row:** N63

## Intent

Rafa asked on 2026-11-11 for the second of two seller gaps found after the first audit deal.

**Problem.** The seller adapter fills one template per seller. Every quote gets the same checks, the same windows and the same proof requirement; only the scope's values change. Real jobs differ: a larger audit needs a longer delivery window, and a buyer may want a proof of concept for every finding. The buyer signer shows the buyer's agent the offer and its price, but not how this offer differs from what the seller usually offers.

**Goal.**
- The seller writes declarative rules in its configuration: when a scope field or a buyer's option meets a condition, the offer gets other windows, more or fewer checks, a longer description, or a refusal. The adapter applies them to each quote. Nothing in a rule, a scope or an option runs as code.
- The adapter publishes the seller's defaults (the template and the windows) at `GET /defaults`, so any buyer reads the same ones.
- The signer reads the offer from every operator, compares it with those defaults, and shows the buyer's agent each changed check, window and requirement with its old and new value. It records what it showed. Before it signs, it reads the offer again and refuses when it differs from what it showed.

**Inputs.** From the buyer: the scope and, new, `options`. From the seller: the template, `timing`, and the new `options` and `termsRules` settings. For the signer: the defaults, as a URL or as an object.

**Outputs.**
1. `examples/seller-adapter.ts`: option rules, terms rules (conditions on `scope.<field>`, `scope.<field>.length` or `options.<field>`; effects on windows, checks, the description, or a refusal), `GET /defaults`, and the two small fixes from T-326's triage: a template can hold a literal `{{…}}` (written `\{{…}}`), and a template's `fee` reaches the offer.
2. `examples/buyer-signer.ts`: `quote(url, scope, options?)`, `readOffer(id, {defaults})` with `windows` and `differences` on the offer, and a `checkOffer` that refuses an offer that differs from the one shown.
3. Tests: two scopes with different checks and windows, each ending `Released`; an option that adds a proof requirement; options and scopes outside the rules refused with 400 naming the field; the signer's difference list; a read-back that differs from what was shown, refused.

**Non-goals.**
- No judgment of whether terms are fair (D28). The signer shows differences; the buyer's agent decides.
- No limits of the adapter's or the signer's own on amounts, windows or rates (D31). Only malformed input and what the seller's own rules exclude are refused.
- No schema, protocol or package change. The defaults address on the card is a convention.

## Context

- `docs/tasks/T-318-seller-adapter.md`, `T-319-buyer-signer.md`, `T-324-seller-adapter-service.md`, `T-325-buyer-signer-outcome.md`.
- `apps/operator/src/terms.ts`: how the offer's windows become deadlines (`completeTerms`).
- `reports/scratch/t-326-triage.md`: the literal `{{…}}` and the template's fee.
- `site/llms.txt`, "Sell a priced API service" and "A seller's client can carry the buyer's side".

## Acceptance criteria

- [x] The adapter builds each offer's checks, windows and proof requirement from the quote's scope and options by declarative rules in the seller's configuration (tests).
- [x] Two scopes yield different checks and windows, and each deal ends `Released` (test).
- [x] An option adds a proof requirement: the offer carries the check, and a report that lacks the proof is not delivered (test).
- [x] An option or a scope outside the seller's rules is refused with 400 and a message naming the field, and no offer is made (test).
- [x] The signer shows the differences from the seller's published defaults: each changed check, window and requirement, old value and new (test).
- [x] The signer refuses to sign when the offer it reads back differs from what it showed (test).
- [x] The signer still reads every configured operator, and PR 314's quorum setting is unchanged (the diff leaves `#served`, `watch` and `confirmations` as they were).
- [x] `pnpm typecheck`, `pnpm lint` and all the examples' tests pass.

## Out of scope

- `examples/audit-deal.ts` writing a terms file's fee into its template (its own lane).
- A buyer-side negotiation of options after the quote.

## Evidence

All runs on 2026-11-11, on branch `t-330-terms-per-quote`, cut from `origin/main` at `f0b44ef`.

- **Test first (measured).** `pnpm exec vitest run examples/seller-adapter-terms.test.ts` before the implementation: 7 of 7 tests failed, each on the missing behaviour (a 7-day window where the rule sets 10 days, no added check, 200 where 400 was due, no `/defaults` route, no `differences`).
- **The new tests (measured).** `examples/seller-adapter-terms.test.ts`: 8 tests pass in about 3 s. They cover two scopes with different checks and windows, each ending `Released`; an option that adds the `proof-all` check, whose report without proofs is not delivered; options and a scope refused with 400 naming the field, with no API call and no offer; malformed rules refused at start; `GET /defaults`, the escaped placeholder and the template's fee; the signer's difference list against the adapter's defaults, and none for a default offer; `differencesOf` on duplicate ids, a new order and a change of case; a read-back with a new operator fee, hidden differences and an offer never shown, each refused.
- **All the examples' tests (measured).** `pnpm exec vitest run examples tests/site-deploy.test.ts tests/audit-report-template.test.ts`: 25 files passed, 291 tests passed and 13 skipped, in 126 s. That run came before the review fixes; after them, `examples/seller-adapter-terms.test.ts` and `examples/buyer-signer.test.ts` passed again (15 tests), and before that the signer's three test files (23 tests).
- **Types and lint (measured).** `pnpm typecheck` and `pnpm lint` exit 0 after the review fixes.
- **Site (measured).** `node site/build.mjs && node site/check.mjs`: "site check PASS". `site/llms.txt` grew from 97,269 to about 97,800 bytes. `site/index.html` did not change.
- **Review (measured).** One `reviewer` pass on the signer's diff, given CLAUDE.md, `docs/neutrality.md` and the task file: ISSUES, with no Critical or High finding. Fixed here: the difference list missed a second check under one id and a new order beside another change (Medium), and a change of case in a hex-looking value (Low); an error message carried the defaults URL's query (Low). The rest is in the Handoff.
- **Not run.** The full `pnpm verify`, `pnpm snap` (no scenario or judgment code changed) and gitleaks. CI runs them.

## Decisions

1. **Rules are condition lists with fixed effects.** A rule's `when` holds when every condition holds: a value equals a string, number or boolean, or a whole number (or a list's size) lies from `atLeast` to `atMost`. Its effects are windows, dropped checks, added or replaced checks (by id), text added to the description, or a refusal. The adapter checks every rule at start and names the rule and the field it refuses. Nothing is evaluated as code.
2. **Rules decide last.** The windows come from `timing`, then the seller API's `deliverWithinSec`, then each rule that applies, in order. A seller that writes a rule for a size band means it.
3. **A refusing rule runs before the seller's API is asked.** It reads only the scope and options, so a refused quote costs no API call and no signature. The 400's message starts with the fields its conditions name.
4. **Options are optional; the scope is not.** A quote may leave out any option; a condition on a missing option does not hold. An option outside `options` is refused with 400, as a scope field outside `scope` is.
5. **The defaults are published by the adapter at `GET /defaults`, with no credential.** They are the template as written (placeholders included), the configured windows, the template's fee, and the scope and option rules. The card points at them with `pricing.defaults`, a convention in `site/llms.txt`, not a schema change.
6. **The signer fills the defaults' placeholders with the scope it sent itself.** It keeps the scope in the key file at `quote`. Its fill is a few lines with the adapter's grammar, so the signer still needs only `agent.ts` and `verify.ts`.
7. **A difference is `{field, old, new}`.** Fields are `deliverable.<key>`, `checks.<id>`, `checks` (same checks, another order), `rubric`, `fees.adjudication` (when the defaults name a fee) and `deadlines.<window>` in seconds. The offer gains `windows`, its deadlines as the seconds a seller configures.
8. **checkOffer refuses an offer that readOffer did not show with this key, or that reads back differently.** The key file records the shown offer and the filled defaults. checkOffer reads the offer again from every operator, computes the differences again against the same defaults, and compares every field before it compares with the approved offer. A client that passes `differences` that are not the ones computed is refused too.
9. **The literal placeholder is `\{{name}}`.** In the JSON file it is written `\\{{name}}`. The adapter, its start-time check and the signer all skip it.
10. **A template's `fee` reaches the offer.** It must be in the settlement layer's token, in base units; the adjudicator decides whether it takes the deal at that fee.

## Handoff

**Done.** Option rules and terms rules in the adapter's configuration, with an example of each in the shipped one; `GET /defaults`; options passed to the seller's quote and start calls; the escaped placeholder and the template's fee (both from T-326's triage); in the signer, `quote(url, scope, options?)`, `readOffer(id, {defaults})` with `windows` and `differences`, `differencesOf`, and a `checkOffer` that refuses an offer it did not show or that reads back differently; `buy-with-signer.ts` takes an optional defaults URL and options; the two `site/llms.txt` sections.

**Not done.**
- The site deploy that publishes the `llms.txt` sections waits for Rafa.
- The live test seller's card does not list `pricing.defaults`.

**Follow-ups, each out of scope here** (also in `reports/scratch/t-330-triage.md`).
1. **Medium · the defaults are the seller's word.** The signer fetches them once, after the quote, so a seller could serve defaults equal to this one offer. The full offer is still shown and checked. Next: fetch them before the quote, or accept a pinned SHA-256 and record it.
2. **Low · the difference list compares only what the defaults publish.** The adjudicators and `maxSubmissions` are not in the defaults, so they never show as differences.
3. **Low · printing.** `buy-with-signer.ts` prints seller text with `JSON.stringify`, which keeps bidirectional control characters.
4. **Medium, from before this PR · signed fields the buyer's agent is never shown.** `settlement.mode`, `disclosure.level`, `clubId`, `rulebookHash`, `policyId`, `policyHash` and `registryHash` are signed but not in `Offer`, so `checkOffer` never compares them. Its own task.
5. **`examples/audit-deal.ts`** writes a terms file's template without its `adjudication.fee`, so `--terms` runs still get the adjudicator's minimum. One line in `templateOf`.

**How to resume.** `pnpm exec vitest run examples/seller-adapter-terms.test.ts`. To see the defaults: run the adapter against the stub as T-318's Handoff says and `GET http://127.0.0.1:8791/defaults`.
