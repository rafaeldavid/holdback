# T-323: a report converter in the seller adapter

- **Lane:** api (example code)
- **Phase:** 2, settlement on EVM (stable EVM operations, D53)
- **Kind:** 4, API and example code (Change recipes): the examples' tests, no review. A target of 150k tokens.
- **Depends on:** T-316 (`preflightDelivery`, PR 278), T-318 (the seller adapter, PR 284), T-320 (the audit template's shape, PR 287)
- **Paths this task may touch:** `examples/report-converter.ts` and `examples/report-converter.test.ts` (new), `examples/seller-adapter.ts` (only the result-to-delivery path and the configuration field for the mapping), `examples/seller-adapter.test.ts` (new tests only), `examples/seller-adapter-stub.ts` (a second report shape only), new files under `fixtures/data/audit-report/`, `vitest.config.ts` (the new test file's cost line only), `site/llms.txt` (the seller section only), this file. Never: `packages/`, `apps/`, `spec/schemas/`, `contracts/`, `examples/buyer-signer.ts`, `examples/audit-deal.ts`, and the adapter's HTTP server, quote route and journal (T-324 rewrites those).
- **Human gate:** no. A site deploy that publishes an `llms.txt` change waits for Rafa.
- **Status:** in progress
- **Agent/session:** the T-323 session, 2026-11-11, branch `t-323-report-converter`
- **Roadmap:** N59

## Intent

Rafa asked on 2026-11-11 for the gaps that stop a real seller after the first audit deal on Sepolia. This is the first of them.

**Problem.** A seller's API already returns its report in its own JSON shape. The adapter delivers the result's bytes as they come, so today the seller must write code that rewrites its report into the audit template's shape before the adapter can deliver it.

**Goal.** The seller writes a mapping file, which is data, and the adapter converts each result with it before the check run. The seller writes no code.

**Inputs.**
- The mapping file, named in the adapter's configuration.
- The result's bytes from the seller's API: a JSON report in the seller's shape.

**Outputs.**
1. `examples/report-converter.ts`: it loads and checks a mapping file, and converts a report with it into the template's JSON. A report the mapping cannot convert is refused with a message that names the field. It also runs as a command, so a seller can try a mapping on one report before it sells.
2. In `examples/seller-adapter.ts`: a configuration field, `reportMapping`. When it names a mapping file, the adapter converts each result, then runs `preflightDelivery` on the converted bytes, and delivers those bytes. A result it cannot convert is not delivered, and the log names the field. When the field is absent, the adapter behaves as today.
3. Two report shapes under `fixtures/data/audit-report/`, each with its mapping. Both convert to the sample report, and a test runs both through the check run.
4. `examples/seller-adapter-stub.ts` can return its report in a seller's own shape, so a test runs a mapped deal end to end on SimChain.

**What a mapping can say.** Field paths into the report, constants, maps of enumerated values, lists mapped item by item, an optional field, a default, a field present only when another is, and a conversion between a whole number and its decimal text. Nothing more: nothing in a mapping, a scope or a report ever runs as code (hard rule: no code execution; deliverables are untrusted).

**Non-goals.**
- No expressions, string templates, arithmetic or regular expressions in a mapping.
- No change to the HTTP server, the quote route or the journal (T-324), to the buyer's signer, to `audit-deal.ts`, to any package or to `spec/schemas/`.
- No conversion of a format other than JSON.

## Context

- `docs/tasks/T-318-seller-adapter.md`: the adapter and its result-to-delivery path.
- `docs/tasks/T-320-audit-template-fit.md`: the shape a report must take to pass the template.
- `packages/judgment/src/preflight.ts` (T-316): the seller's check run.
- `examples/seller-adapter.template.json` and `fixtures/terms/audit-report.yaml`: the template's five checks.
- `CLAUDE.md`, hard rules: no code execution, deliverables are untrusted, no float in a hashed body.

## Acceptance criteria

- [ ] A seller maps its API's report to the template's JSON with a mapping file and no code.
- [ ] The converted report passes the seller's check run (`preflightDelivery`).
- [ ] A fixture converts two differently shaped reports to the template, and a test runs both through the check run.
- [ ] A report the mapping cannot convert is refused with a message that names the field, and is never delivered (test).
- [ ] A mapping that holds anything but data is refused when it loads (test).
- [ ] The adapter converts a result when its configuration names a mapping file, and behaves as today when it names none (test).
- [ ] The converted report holds no number that is not a whole number (test).
- [ ] `pnpm typecheck`, `pnpm lint` and the examples' tests pass.

## Out of scope

- The adapter as a service (N61, T-324), the buyer signer (N62, T-325), the audit deal script (N64, T-326), reference files (N66, T-327).
- N60 and N63, which wait for these to land.

## Evidence

Fill this in before review. Label each item measured, inferred or guessed.

## Decisions

## Handoff
