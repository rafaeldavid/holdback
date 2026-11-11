# T-331: the seller adapter starts from one configuration file

- **Lane:** api (example code)
- **Phase:** 2, settlement on EVM (stable EVM operations, D53); the pilot's package 2
- **Kind:** 4, API and example code (Change recipes): the examples' tests, one reviewer pass before merge, a target of 150k tokens
- **Depends on:** T-318 (the adapter), T-323 (the report mapping), T-324 (the service recipe), T-329 (redelivery, PR 317), T-330 (terms per quote, PR 316); all merged
- **Paths this task may touch:** `examples/seller-adapter.ts`, `examples/seller-adapter.test.ts`, `examples/seller-adapter-terms.test.ts`, `examples/seller-adapter-stub.ts`, `examples/seller-adapter.template.json`, a new `examples/seller-adapter.config.json`, `examples/seller-adapter-service.md`, `examples/seller-adapter.service`, `examples/seller-adapter.Caddyfile`, `examples/seal.ts`, this file. Never: `site/llms.txt` (a later package places the doc lines in the Handoff below), `examples/buyer-signer.ts` and its tests (T-332), `examples/audit-deal.ts`, `packages/`, `apps/`, `spec/schemas/`, `contracts/`.
- **Human gate:** no. Nothing here deploys or runs live.
- **Status:** review (PR 319)
- **Agent/session:** the T-331 session, 2026-11-11, branch `t-331-seller-adapter-one-config`

## Intent

**Problem.** A seller that installs the adapter today sets it up in several places that grew in one day: a configuration block inside `examples/seller-adapter.ts` (T-318, T-323, T-324, T-329, T-330), the systemd unit, the Caddyfile and the environment. The block defaults to the club `sim-club` and to zero-address adjudicators, so a seller on Sepolia must edit source code. The adapter never asks for the mandate it needs to offer, and never renews it when the test service's 30-day mandate runs out. A rule cannot add a rubric, so a buyer cannot ask for a panel on one deal. And the refusal note points to `seal.ts`, which signs under the SimChain domain and so likely fails on Sepolia.

**Goal.** A seller's install is one JSON configuration file and its keys in the environment:

1. `node examples/seller-adapter.ts <config.json>` starts the adapter with no source edit. Every field but `sellerApi` has a default; relative paths in the file are read beside it.
2. The club and the three adjudicators default to the ones the operators' discovery document names (`demo.clubId`, `demo.adjudicators`). A seller may still name its own.
3. A start stops, with the reason, when the seller holds no mandate in the club, or when an adjudicator is the zero address.
4. On the test service (discovery offers a faucet for the club), the adapter takes its mandate from the faucet at start and renews it before it runs out.
5. A terms rule may add the template's optional rubric to one offer, so a buyer's option asks for the panel.
6. Four options go: `stream` (the event-stream follower; polling covers it), `host` (always 127.0.0.1), `quoteRateLimit.perClient` and `trustProxy`. A file that still sets one is refused with the reason.
7. The refusal note points to a manual path that signs under the domain the operators serve.

**Unchanged.** The adapter signs only with the seller's key; the key and the operators come from the environment only. Every request address comes from the configuration, never from a report, a scope or an option. Nothing from the configuration, a rule, a scope or a report runs as code. The seller's values are its own choices (D31). The quote, start, result and delivery paths, the journal and the deliver-once guarantee stay as they are.

**Non-goals.** One source for the terms (simplification 5 of the pilot plan). The `llms.txt` text (package 5). Any protocol, schema or package change.

## Context

- crow-private `roadmap/plans/2026-11-11-pilot-refocus.md`, section 5, package 2, and section 4.2, items 4 and 9.
- `docs/tasks/T-318-seller-adapter.md`, `T-324-seller-adapter-service.md`, `T-329-…`, `T-330-…`.
- `apps/demo-cloud/src/world.ts`, `grantFrom`: the faucet signs a fresh 30-day mandate in the demo club with each grant, once per address per hour.
- `apps/operator/src/server.ts`: `GET /v1/agents/{address}` lists an agent's mandates; `POST /v1/faucet` takes an amount of 1 base unit or more.

## Acceptance criteria

- [x] `node examples/seller-adapter.ts <config.json>` starts with no source edit; a file with only `sellerApi` starts on the shipped defaults (test, as a child process).
- [x] Without `clubId` and `adjudicators`, the adapter offers in the club and with the adjudicators that discovery names (test).
- [x] A start with no mandate in the club, or with a zero-address adjudicator, stops and says why (tests).
- [x] On the test service, a fresh key takes its mandate from the faucet at start, and after the clock moves 30 days the adapter renews it and offers again (test).
- [x] A terms rule with `rubric: true` adds the template's `optionalRubric` to one offer; an offer without the option carries none (test).
- [x] `stream`, `host`, `quoteRateLimit.perClient` and `trustProxy` are gone; a file that sets one is refused, naming it (test).
- [x] `seal.ts` signs under the domain the operators serve, pinned as the adapter pins it, and the refusal note's manual path names it with the journal (test).
- [x] T-329 triage row 2: a refused deal that is not due makes no state read at each poll (test, reads measured before and after).
- [x] `pnpm typecheck`, `pnpm lint` and the examples' tests pass.

## Out of scope

- A lock that stops two adapters on one journal; pruning the journal.
- The other T-329 triage rows (alert outbox, a limit on the ready route).

## Evidence

All runs on 2026-11-11, on branch `t-331-seller-adapter-one-config`, cut from `origin/main` at `1430f77`.

- **Test first (measured).** With the new tests written and the adapter unchanged, `pnpm build` failed on the tests: `loadConfig` is not exported, `mandate` is not a configuration field, and `rubric` is not a field of `TermsRule`.
- **The adapter's tests (measured).** `examples/seller-adapter.test.ts` and `examples/seller-adapter-terms.test.ts`: 49 tests pass, 18 of them new or changed. The new and changed ones cover:
  - a start as a child process from a file that names only `sellerApi`: the offer names the club and the three adjudicators discovery serves, the journal lands in the working directory, exit 0 on SIGTERM, and no key in the output; the usage and an unreadable file exit 2;
  - `loadConfig`: the shipped defaults, paths beside the file, merged windows, and refusals that name the field (no `sellerApi`, `scope` missing with an own template, an unknown field, an unknown window, a non-http address, each of the four removed options, broken JSON); the shipped example file loads;
  - a misspelt field inside `redelivery`, `mandate` or `alerts` is refused, naming it (from the review);
  - a zero-address adjudicator, and operators whose discovery names no club, stop the start;
  - a fresh key with no mandate on SimChain stops with "holds no mandate in club sim-club, and the faucet granted none", and with `fromFaucet: false` names the club's principal;
  - on the demo world (`PublicWorld`), a fresh key takes its mandate from the faucet at start; after the world's clock moves 30 days and 2 hours, the next quote renews it (the new mandate ends later) and answers 200;
  - the `panel` option adds the template's five-criterion rubric and changes no check; an offer without it carries no rubric; the primary adjudicator accepts the panel offer; `GET /defaults` publishes `optionalRubric`; a rubric rule over a template without one fails to load from a file and answers 400 with no offer when set in code; an empty `optionalRubric` is refused;
  - the rate limit, HTTPS and recipe tests, rewritten for `quoteRateLimit.overall` and the unit's `ExecStart` with the file path;
  - the manual path: with no redelivery set, the note names `seal.ts <journal> <file> <commitmentId>`; `seal.ts` delivers the fixed file, the deal ends Released, and after a restart the adapter records `delivered` with one `delivery.submitted`; `seal.ts` refuses operators that serve an unpinned domain, naming it.
- **T-329 triage row 2, reads before and after (measured).** The test counts the adapter's `GET /v1/commitments/<id>` calls for a refused deal over 1 s of 50 ms polls on two operators. With the early return disabled: 40 reads. With it: 0. At the shipped 5 s poll, 40 reads a second scales to about 2 reads every 5 s per operator, which is the triage row's estimate of about 120,000 reads per operator over 7 days (inferred from the measured rate, not run for 7 days).
- **All the examples' tests (measured).** `pnpm exec vitest run examples tests/ci-gated.test.ts`: 24 files, 262 passed, 13 skipped (the anvil tests, which skip without anvil), 111 s.
- **Lint and types (measured).** `pnpm build` (tsc -b) and `pnpm lint` pass.
- **Review (measured).** One `reviewer` pass on the diff, with CLAUDE.md as context: ISSUES, no Critical or High, 2 Medium, 10 Low. Fixed: both Mediums (misspelt nested fields now refused; the faucet is asked again only a minute after a refusal) and Lows 3 (a fixed 5 s wait step after a grant), 7 (the note's journal path is absolute) and 10 (an empty `optionalRubric` is refused). The rest are in `reports/scratch/t-331-triage.md`.
- **Not run.** Sepolia, Caddy and systemd themselves. On a chain the adapter waits up to 60 s for both operators to list a new mandate (inferred from the faucet's code, not run live).

## Decisions

1. **The file holds data only, and every field but `sellerApi` defaults.** `loadConfig` reads one JSON object and refuses an unknown field, naming it. `template` and `reportMapping` are read beside the file. `journal` stays relative to the working directory, as before: the systemd unit's configuration sits in read-only `/etc`, and the journal in the state directory. `timing` may name only the windows it changes. With the seller's own template, `scope` is required and the shipped `options` and `termsRules` do not apply, since they name the shipped template's fields.
2. **The club and the adjudicators come from discovery when the file leaves them out.** The adapter reads `demo.clubId` and `demo.adjudicators` from the same trusted read that pins the domain, so every operator must serve the same values. A seller's own values win. A zero address, a malformed address, or a club that neither names, stops the start with the reason.
3. **The mandate.** At start the adapter reads its mandates (`GET /v1/agents/{address}`, a trusted read) and needs one in the club with the seller role that lasts past `renewBeforeSec` (default 86,400 s). When discovery offers a faucet for this club, it asks the faucet (`POST /v1/faucet`, 1 base unit, since the faucet takes no zero) and reads the mandate again; it waits up to about a minute for both operators to list a new one. Without a faucet, or with `mandate.fromFaucet: false`, a start with no mandate stops and names the club's principal. A quote checks the mandate first and renews it when it ran out; the poll loop checks once a minute. A quote with no mandate gets 503 `seller_unavailable` and makes no offer. After the faucet refuses, the adapter asks it again only a minute later. The faucet's address is the configured operators' `/v1/faucet`, never one taken from discovery.
4. **The rubric effect.** A terms rule's `rubric: true` puts the template's `optionalRubric` in the offer, and `rubric: false` takes any rubric out. The shipped template gains the five audit criteria of `fixtures/terms/audit-report-rubric.yaml` as `optionalRubric`, and the shipped configuration gains the option `panel` with the rule that adds it. A template's `rubric`, when present, still applies to every offer, so an existing template behaves as before. `GET /defaults` publishes `optionalRubric`, so a buyer reads what the option adds before it asks. A rubric rule over a template with no `optionalRubric` stops a configuration file from loading; set in code (as `audit-deal.ts` spreads the defaults over its own template), the adapter starts and answers 400 to a quote that asks for the panel, so a buyer never gets an offer without the panel it asked for.
5. **Four options removed, each refused with what to do instead.** `stream`: the adapter polls every `pollMs` (default 5,000 ms), so a funded hold starts its job up to one poll later than with the stream. `host`: always 127.0.0.1. `quoteRateLimit.perClient` and `trustProxy`: the adapter keeps `quoteRateLimit.overall` after `quoteAuth`; a limit per client address belongs in the proxy. This is a stated change: an unauthenticated request is no longer counted by the adapter. It costs the seller nothing: it gets 401 before the body is read and makes no offer.
6. **`seal.ts` pins the served domain.** It signs through `pinnedSeller`, the adapter's own pin (SimChain, Sepolia or `HOLDBACK_DEPLOYMENT`), and refuses any other. It also reads the terms from the adapter's journal by commitment ID, so the refusal note's manual path is one command a seller can run: `node examples/seal.ts <journal> <file> <commitmentId>`.
7. **T-329 triage row 2, taken.** A refused deal that is neither ready nor due (no refetch time and not `deliverBy`) reads nothing: the pass reads settlement time once and shares it. The first pass after a start reads every open deal in full, so a delivery made by hand while the adapter waited is recorded at the next start, and at the next due fetch or `deliverBy` otherwise. The settlement layer still takes one delivery per commitment.

## Handoff

### State

Done: every acceptance criterion, with the review's Mediums fixed. Not done: the review's other Lows (`reports/scratch/t-331-triage.md`), and no live run. `examples/audit-deal.ts` still spreads `config` with its own template; it keeps working because a rubric rule over a template without `optionalRubric` refuses only a quote that asks for the panel. Package 3 may load its seller from a file with `loadConfig` instead. `examples/buyer-signer.ts` (T-332) does not read `optionalRubric` from the defaults, so a panel offer shows its rubric as a difference.

### Doc lines for `site/llms.txt` (package 5 places them; "Sell a priced API service")

- Start the adapter from one file: `node examples/seller-adapter.ts seller.json`, with `HOLDBACK_KEY` and `HOLDBACK_OPERATORS` in the environment. Only `sellerApi` (your API's quote, start and result addresses) is required; `examples/seller-adapter.config.json` is an example. You edit no source file.
- The club and the three adjudicators default to the ones the operators' discovery document names (`demo.clubId`, `demo.adjudicators`). Name `clubId` and `adjudicators` in the file to choose your own.
- Every offer needs a mandate in the club. On the test service the adapter takes one from the faucet at start and renews it before its 30 days end. Elsewhere your club's principal gives you one; a start without one stops and says so.
- A buyer adds `"options": {"panel": true}` to a quote to have a panel of judges score the report on the template's five criteria after the checks pass. A terms rule with `"rubric": true` adds the template's `optionalRubric`; `GET /defaults` publishes it.
- Removed in T-331: `stream`, `host`, `trustProxy` and `quoteRateLimit.perClient`. A file that sets one is refused; limit per client in your proxy.
- To deliver a fixed report by hand: `node examples/check-delivery.ts <terms.json> <file>`, then `node examples/seal.ts <journal> <file> <commitmentId>`.
