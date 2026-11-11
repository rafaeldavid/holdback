# T-330: terms set per quote, and the buyer sees how they differ

- **Lane:** api (example code), with two sections of the agent docs
- **Phase:** 2, settlement on EVM (stable EVM operations, D53)
- **Kind:** 4, API and example code (Change recipes): the examples' tests, no review, a target of 150k tokens. One `reviewer` pass on the signer's diff, because it changes what a buyer signs. The `site/llms.txt` edits are kind 1.
- **Depends on:** T-318 (the seller adapter), T-319 and T-325 (the buyer signer), T-324 (the adapter as a service), PR 314 (the signer's quorum fix).
- **Paths this task may touch:** `examples/seller-adapter.ts` (the quote route's terms building, `loadTemplate`, `fill` and the configuration fields this task adds), `examples/seller-adapter.template.json`, `examples/seller-adapter-stub.ts`, `examples/buyer-signer.ts`, `examples/buy-with-signer.ts`, their test files or new test files beside them, `vitest.config.ts` (cost lines for new test files only), `site/llms.txt` (the sections "Sell a priced API service" and "A seller's client can carry the buyer's side" only), `site/index.html` (only as `node site/build.mjs` regenerates it), this file. Never: `packages/`, `apps/`, `spec/schemas/`, `contracts/`, the adapter's result-to-delivery path (T-329).
- **Human gate:** no. The site deploy that publishes the `llms.txt` edits waits for Rafa.
- **Status:** in progress
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

- [ ] The adapter builds each offer's checks, windows and proof requirement from the quote's scope and options by declarative rules in the seller's configuration (tests).
- [ ] Two scopes yield different checks and windows, and each deal ends `Released` (test).
- [ ] An option adds a proof requirement: the offer carries the check, and a report that lacks the proof is not delivered (test).
- [ ] An option or a scope outside the seller's rules is refused with 400 and a message naming the field, and no offer is made (test).
- [ ] The signer shows the differences from the seller's published defaults: each changed check, window and requirement, old value and new (test).
- [ ] The signer refuses to sign when the offer it reads back differs from what it showed (test).
- [ ] The signer still reads every configured operator, and PR 314's quorum setting is unchanged.
- [ ] `pnpm typecheck`, `pnpm lint` and all the examples' tests pass.

## Out of scope

- `examples/audit-deal.ts` writing a terms file's fee into its template (its own lane).
- A buyer-side negotiation of options after the quote.

## Evidence

Filled in before landing.

## Decisions

Filled in as the work goes.

## Handoff

Filled in before landing.
