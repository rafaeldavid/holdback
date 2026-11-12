# T-391: The two-agent run

- **Lane:** test
- **Phase:** 2
- **Depends on:** T-021 (tools/sim), T-328 (the outsider test), T-066 (tools/one-click), T-355 (audit-deal), the client tools on `contracts-audit-ready`
- **Paths this task may touch:** `tools/duet/`, the root `package.json` (one script), `vitest.config.ts` (one include line and one cost entry), this file, one row in `docs/testing.md`
- **Human gate:** no for the build. The live run is Rafa's: it sends prompts to two model vendors with his keys.
- **Status:** review
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

Four scenarios, one flag each:

- `paid` ends Released, with the buyer opening the report.
- `refund` ends Refunded, with no key released to the buyer. The seller delivers a report that fails a required check.
- `bad-offer` ends with no hold. The seller offers terms without a check the buyer's owner requires.
- `late-offer` ends with no hold. The seller's terms give it three years to deliver; the owner's policy refuses them (added at the coordinator's request, after a High in the buyer's tool about postdated offers).

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

- [x] `pnpm duet run --scenario paid|refund|bad-offer|late-offer` with `--buyer scripted --seller scripted` runs end to end on the local phase-one world and ends as stated.
- [x] Each run leaves `record.jsonl`, `summary.json` with the seven measures, and `replay.html`, which opens from the file with no server.
- [x] A fetch outside the allowlist and a command outside the list are refused and recorded; no key appears in a prompt, a tool result, the record or the page.
- [x] Turn and token caps end a run as `stalled`, with what the agent was trying to do.
- [x] A live run prints the two models, the caps and a cost ceiling from the price file, then waits 10 s. A missing key stops it in one line, with nothing sent. `list` sends nothing.
- [x] One reviewer and one red team (tool limits and the record); every Critical and High is fixed.
- [x] A run over a limit in `limits.json`, or a stalled one, writes `ticket.md`; one under every limit writes none (coordinator, from Rafa).
- [x] The page is in plain buying words, titled "Crow" with a value statement, stands alone, and links out to the public sources; a test bans protocol words from the reader's text (coordinator, from Rafa).

## Out of scope

- Changing the client tools in `examples/` (T-390 is changing the buyer's; findings go to the coordinator).
- Running against Sepolia (after the redeploy; see Handoff).

## Evidence

Each item is labelled measured, inferred or guessed.

- **The four scripted scenarios end as stated, on the local phase-one world** (measured, 2026-11-12, `node tools/duet/duet.ts run --scenario <name> --buyer scripted --seller scripted`):
  - paid: Released, and the buyer opens the report. 383,478 tokens (scripted: characters ÷ 4), 16 turns, about 5 s.
  - refund: Refunded. The adjudicator rejects on the coverage check, and the only key released goes to the adjudicator. 540,409 tokens, 21 turns.
  - bad-offer: no hold. The buyer sees the offer and turns it down. 440,023 tokens.
  - late-offer: no hold. The owner's policy refuses a three-year delivery window. 523,450 tokens. It writes one ticket by design: the scripted buyer asks to approve.
- **Tests** (measured): `npx vitest run tools/duet` passes 24 of 24 in about 31 s with no key. The suite covers:
  - the four scenarios, each with a leak scan of the record, the summary and the page;
  - the tools' fences;
  - the red teams' attacks: the argument shift, the hollow required check, and the operator's clock;
  - the policy's date band and the measures;
  - the mainnet guard (chains 1 and 100, and a missing chain ID);
  - the providers' wire format, with the key only in a header;
  - the agents' key names, with no fallback to the judges' keys;
  - `list` and a missing key on the command line;
  - a typecheck of this folder.
- **Other checks** (measured): `npx tsc -p tools/duet` and `npx eslint tools/duet` exit 0. `npx vitest run tests packages/core/src/money` passes 498 of 498.
- **Review** (measured, its report): ISSUES, with 2 Highs, 6 Mediums and 3 Lows.
  - Fixed: both Highs (the measures picked the least-settled deal; an empty no-hold run scored as right) and every Medium (the cost ceiling, hard time limits and cleanup, stall counting, the repository's mainnet list, a typecheck, CLI validation).
  - The Lows are in the Handoff.
- **Red team, first pass** (measured):
  - One Medium, fixed: check-delivery's argument shift opened a file outside the folder, showing its size and SHA-256, never its content.
  - One Low, fixed: commitment IDs from the seller's journal now count only for this run's buyer or seller.
  - What held: the allowlist, the adapter-config fence, the copied config, the child environment built from nothing, and escaping on the page.
- **Red team, second pass** (measured): no key leak found.
  - One High, fixed: a required check was matched by ID only, so a hollow "coverage" check let the refund case end Released. The policy now compares the owner's own copy of each check, whole.
  - One Medium, fixed: one operator's clock decided the dates. The policy now takes every operator's clock and the local clock.
  - Lows, fixed: deadlines in seconds, uppercase and base64 secret forms, whole log lines.
- **/verify, kind 4** (measured, after merging the lane tip with T-389): `pnpm exec vitest run tools/duet tests` passes 471 of 471 tests in 21 files; `npx tsc -p tools/duet` exit 0; `pnpm lint` exit 0. No snapshot diffs.
- **What the scripted runs do not show** (stated plainly): whether a model can do the deal from the docs. Only Rafa's live run shows that.
- Snapshot diffs: none; no scenario fixture changes.

## Decisions

- **Name: `tools/duet`, `pnpm duet`.** Two voices in one piece; short, and nothing else in the repository uses it.
- **The API calls are recorded with a fetch hook preloaded into each client command (`fetch-log.mjs`), not with a recording proxy.** A proxy in front of the operators changes their origin, and the buyer's signer then refuses the delivery: it accepts the work only on one of its own operators (measured). That check is right, so the record takes the calls from inside the commands instead.
- **The buyer's approval stop is answered by the owner's policy in the run tool, not by `--expect-terms`.** An `--expect-terms` file must state every window and the adjudicators in advance, which no owner knows before a quote. The policy checks:
  - the budget;
  - the owner's own copy of each required check;
  - the latest delivery date and the judging slack;
  - a createdAt band;
  - agreement between the clocks.
  The record counts each approval as pre-set by the owner, and measure 6 records a refused one.
- **The refund scenario's seller delivers by hand with `seal.ts`.** Crow's seller adapter runs the agreed checks before it delivers, so it would hold a failing report back. The seller's owner tells it to deliver whatever the job returns, and the page says so.
- **The agents' keys are `HOLDBACK_AGENT_*`, never the judges' variables** (Rafa via the coordinator). The judges' keys are also scrubbed wherever they might appear.
- **The local docs are the published bytes**, built with `site/build.mjs` (`strip`, `tryCommand`, `sellerPage`), with only OP1 and OP2 changed. The record's `world` line lists the change.
- **The page's first line is plain** ("a local test setup, with test money"). The exact engine stays in the engineers' section, the record and the summary. This weighs the coordinator's engine note against Rafa's plain-words direction. The coordinator can overrule it.
- **The first limits are guesses**: the measured scripted counts times 3 for tokens, times 4 for turns and tool calls, times 3 for API calls, and 60 s for paying the seller.

## Handoff

**Done:** the runner, the providers, the fenced tools, the local world, the four scenarios, the record, the measures, the limits and tickets, and the page, all reviewed and red-teamed. What is not done is below.

**The live run is Rafa's.** One line, with his env file. The file holds `HOLDBACK_AGENT_ANTHROPIC_API_KEY`, `HOLDBACK_AGENT_OPENAI_COMPATIBLE_API_KEY` and `HOLDBACK_AGENT_OPENAI_COMPATIBLE_BASE_URL=https://api.deepseek.com`. Run once first, from the repository root: `pnpm install && pnpm build`.

    node --env-file=<his env file> /Users/rafa/Documents/escrow/tools/duet/duet.ts run --buyer deepseek --seller claude --scenario paid

`node /Users/rafa/Documents/escrow/tools/duet/duet.ts list --buyer deepseek --seller claude` shows the models, the caps and the cost ceiling, and sends nothing. With the default caps of 60 turns and 3,000,000 tokens per agent, the ceiling is USD 30.74 per run at list prices (measured: printed by `list`). A real run should cost far less with caching.

**Whoever picks up his run folders:**
1. Read each folder's `ticket.md` first, if there is one, and send it to the coordinator, who routes each item to its owner.
2. Then treat every stall as a finding with an owner: the docs, an error message, a tool, or the runner. Write it here.
3. Tune `limits.json` from the first live counts.

**Against Sepolia, after the redeploy** (inferred, not run):
- Pass `--world <op1>,<op2>`; the docs default to crow.direct's.
- The buyer's signer takes test funds from the faucet itself. Check that the faucet's grant covers the stub's 700.00 price; the local grant is 1,000.00 per call.
- The seller page and the job API stay on this machine, on 127.0.0.1.
- The page then links each payment record and the order's record on the live service.

**A run with a person in place of one agent** would need:
- a chat or terminal surface that shows the person the same brief, the docs links and the tool results;
- a way for the person to act: the same `run_command` and fetch tools behind buttons, or the person running the client tools themselves;
- the record keeping the person's actions as `human` events, so measure 4 counts them;
- the owner's policy still answering the approval stop, unless the person answers it, which then counts as an intervention.
The loop's provider interface (`turn()`) is the seam: a "human" provider would wait for the person's next action instead of calling a model.

**Open, Low** (from the review and the red teams):
- `freePort()` closes then reuses a port, which can race under heavy parallel load.
- The secret list does not catch a key split by a newline, JSON `\u` escapes, half a key, or a reversed key. No command prints a key today.
- The root `tsconfig.json`, outside this task's paths, does not reference `tools/duet`. A test runs `tsc -p tools/duet` instead; adding the reference would put it in `pnpm typecheck`.
- The reviewer recommends a second-family red team on the fences and key handling. That review is Rafa's to run.

**Decisions for Rafa:**
- the first scenario's brief (`tools/duet/scenarios.ts`: an audit of 3 files, 400 lines, a 750.00 budget, the coverage and scope checks, delivery within 3 days);
- whether a replay page may later go on the public site;
- whether the engine name goes on the page's first line or stays in the engineers' section.
