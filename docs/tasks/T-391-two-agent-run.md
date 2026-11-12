# T-391: The two-agent run

- **Lane:** test
- **Phase:** 2
- **Depends on:** T-021 (tools/sim), T-328 (the outsider test), T-066 (tools/one-click), T-355 (audit-deal), the client tools on `contracts-audit-ready`
- **Paths this task may touch:** `tools/duet/`, the root `package.json` (one script), `vitest.config.ts` (one include line), this file, one line in `docs/testing.md` (through the docs session if it is in flight)
- **Human gate:** no for the build. The live run is Rafa's: it sends prompts to two model vendors with his keys.
- **Status:** in progress
- **Agent/session:** T-391 session, change kind 4

## Intent

One command runs a whole deal between two model-driven agents from two vendors, a buyer and a seller, and leaves a record anyone can replay. Each agent is a raw tool-use loop over a vendor's API: Anthropic's Messages API or DeepSeek's OpenAI-compatible chat completions, by pinned model IDs. Either vendor can play either role.

An agent knows only what an outsider knows: the public agent docs it fetches over HTTP from the world it runs against, a short brief from its owner, and an empty folder of its own. It can use only its owner's installed tools:

- a fetch limited to an allowlist;
- a run tool limited to a fixed list of the repository's client commands;
- reading and writing inside its own folder.

The signing keys stay in files and environments the agent never sees. The buyer's approval stop is answered by an owner policy file, not by a person, and the run reports each such approval as pre-set by the owner.

The two agents meet only through Crow. The seller publishes its quote address on its own page. The buyer finds the page, reads the terms and funds. The seller delivers, the adjudicators judge and the chain settles.

The runner starts the local phase-one world with two operators, or takes `--world` for a running one (later Sepolia). It also serves the docs and a small audit-report job API built from the repository's own template and fixtures.

Three scenarios, one flag each:

- `paid` ends Released, with the buyer opening the report.
- `refund` ends Refunded, with no key released. The seller delivers a report that fails a required check.
- `bad-offer` ends with no hold. The seller offers terms without a check the buyer's owner requires.

Outputs:

- a JSON-lines record of every model turn, tool call, API call and chain event;
- a summary with the seven measures Rafa tracks;
- a self-contained replay page generated from the record alone.

Non-goals:

- a run with a person in place of one agent;
- a VM or an in-browser chat;
- any change to the client tools themselves (reported to the coordinator instead);
- proving that a model can do the deal.

**The scripted runs prove the harness, not the models.** CI drives the same loop with a scripted provider that replays fixed tool calls. That proves the runner, the tools' limits, the record, the measures and the replay page. Only Rafa's live run shows whether a model can do the deal from the docs.

## Context

- `tools/sim/README.md` (T-021): model agents against a local world; its briefs and its limits ("nothing else enforces a party's limits").
- `docs/tasks/T-328-outsider-design-tests-buyer.md`: a fresh agent with only the docs.
- `tools/one-click/` (T-066): approvals, turns and tokens for one deal.
- `apps/adjudicator/src/providers/live.ts`: the judges' provider clients and their environment variable names.
- `config/judges-live.yaml` (the pinned model IDs) and `config/model-prices.json` (prices).
- `examples/buy-with-signer.ts`, `buyer-signer.ts`, `seller-adapter.ts`, `seller-adapter-stub.ts`, `check-delivery.ts`, `seal.ts`, `deal-record.ts`; `site/llms.txt`, `site/sell.txt`.
- `apps/demo`, `site/visualdemo/index.html`: the scripted demo this replay replaces.

## Acceptance criteria

- [ ] `pnpm duet run --scenario paid|refund|bad-offer` with `--buyer scripted --seller scripted` runs end to end on the local phase-one world and ends as stated.
- [ ] Each run leaves `record.jsonl`, `summary.json` with the seven measures, and `replay.html`, which opens from the file with no server.
- [ ] A fetch outside the allowlist and a command outside the list are refused and recorded; no key appears in a prompt, a tool result, the record or the page.
- [ ] Turn and token caps end a run as `stalled`, with what the agent was trying to do.
- [ ] A live run prints the two models, the caps and a cost ceiling from the price file, then waits 10 s. A missing key stops it in one line, with nothing sent. `list` sends nothing.
- [ ] One reviewer and one red team (tool limits and the record); every Critical and High is fixed.

## Out of scope

- Changing the client tools in `examples/` (T-390 is changing the buyer's; findings go to the coordinator).
- Running against Sepolia (after the redeploy; see Handoff).

## Evidence

Fill this in before review. Label each item measured, inferred or guessed.

- Commands run and results:
- Snapshot diffs: none (no scenario fixtures change).
- Metrics:

## Decisions

## Handoff
