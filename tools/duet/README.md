# Two-agent run (T-391)

`pnpm duet` runs one whole deal between two model-driven agents from two vendors, a buyer and a seller, and leaves a record anyone can replay. Test tokens only: SimChain locally, or a testnet world named by its operators.

Each agent is a tool-use loop over a raw model API: Anthropic's Messages API, or DeepSeek's OpenAI-compatible chat completions. Models are pinned by ID from `config/judges-live.yaml`. Either vendor can play either role.

An agent knows what an outsider knows:

- the public agent docs, which it fetches over HTTP;
- one short brief from its company;
- an empty folder of its own.

The two agents meet only through Crow. The seller publishes a card on its own page. The buyer finds it, asks for a quote, checks the offer and funds it. The seller delivers, the adjudicator judges and settlement pays out.

**The scripted runs prove the harness, not the models.** CI drives the same loop with a scripted provider that replays fixed tool calls. That proves the runner, the tools' limits, the record, the measures and the replay page. Only a live run shows whether a model can do the deal from the docs.

## Run it

```
pnpm duet list --buyer deepseek --seller claude                   # the models, the caps, the most a run can cost; sends nothing
pnpm duet run --scenario paid --buyer scripted --seller scripted  # no keys: the harness end to end, about 5 s
node --env-file=<env file> tools/duet/duet.ts run --buyer deepseek --seller claude --scenario paid
pnpm duet replay <run folder>                                     # the summary and the page again, from record.jsonl
```

The live run reads the agents' own keys, never the live judges'. There is no fallback, so a run never spends from, or exposes, the adjudicators' keys:

- for Claude: `HOLDBACK_AGENT_ANTHROPIC_API_KEY`;
- for DeepSeek: `HOLDBACK_AGENT_OPENAI_COMPATIBLE_API_KEY` and `HOLDBACK_AGENT_OPENAI_COMPATIBLE_BASE_URL` (https only).

The record and the page name the vendor and the pinned model, never anything of a key.

Before a live run sends anything, it prints the two models, the caps and the most the run can cost at list prices, then waits 10 s. The ceiling is each agent's token cap at its dearest input price (a cache write costs more than plain input), plus every turn's output cap at its output price. The loop stops before a turn that would pass the token cap. A missing key stops the run with one line, with nothing sent. Run `pnpm build` once first, or use `pnpm duet`, which builds what it needs.

| Option | Default | What it does |
| --- | --- | --- |
| `--scenario` | (required) | `paid`: ends Released, and the buyer opens the report. `refund`: the job returns a report that leaves out a file in scope, the seller delivers it as it is, the coverage check fails, and the deal ends Refunded with no key released to the buyer. `bad-offer`: the seller drops the coverage check, which the buyer requires, and the run ends with no hold. `late-offer`: the seller's terms give it three years to deliver, the company's policy refuses to approve them, and the run ends with no hold. |
| `--buyer`, `--seller` | (required) | `claude`, `deepseek` or `scripted` |
| `--brief` | `guided` | What each company tells its agent. `guided` names Crow's guides and how to use them. `direct` is the cold start: only the intent, the company's limits and facts about its own setup, and "through crow.direct". The agent finds the guides from the home page, as a visitor would. A local run answers crow.direct from this machine's copy of the site, home page included; the record's `world` line and the page say so. A run against a named world uses the real site. |
| `--buyer-model`, `--seller-model` | `deepseek-v4-pro`, `claude-opus-5-5` | Another ID of that vendor in `config/judges-live.yaml` |
| `--max-turns`, `--max-tokens` | 60, 3,000,000 | Caps for each agent. A run that hits one ends as stalled, with what the agent was trying to do. |
| `--world <op>,<op>` | none | Operators of a running world. Left out, a local phase-one world starts in this process. |
| `--docs <guide>,<sell>` | `https://crow.direct/llms.txt`, `/sell.txt` | The docs for a running world. A local world serves its own, with its operators filled in. |
| `--out <dir>` | `reports/scratch/duet` | Each run gets its own folder below it. |
| `--grace`, `--timeout` | 90, 1,800 | Seconds the other agent may go on once one finishes, and the whole run's limit |

Exit codes:

- 0: the run ended as the scenario says.
- 1: it did not.
- 2: it could not start.

## What an agent can do

Each tool is a fence enforced in `tools.ts`, not a rule in a prompt.

| Tool | Limit |
| --- | --- |
| `fetch_url` | GET only. Only allowlisted URLs: the world's operators, the guides (`llms.txt`, `buy.txt`, `sell.txt` and the reference pages under `ref/`), the seller's page, the seller adapter's `/quote` and `/defaults`, Crow's problem pages, and for the seller its own job API. No user info in a URL, no redirect followed. |
| `run_command` | One of the company's installed commands, run as `node examples/<command>.ts` from this checkout. The buyer has `buy-with-signer` (no `--expect-terms`), `check-delivery` and `deal-record`. The seller has `seller-adapter` (in the background), `adapter-log`, `check-delivery`, `seal` and `deal-record`. Every argument is checked: paths stay inside the agent's folder, URLs must be allowlisted, the buyer's key store is accepted only by its one path, and amounts stay within the company's budget. The adapter's configuration is checked and then copied out of the agent's reach. Its sellerApi may point only at the company's job API. It may set no credential, callback, template or mapping, no other port, and no URL anywhere else. No shell. The child process gets an environment built from nothing: the operators, and for the seller its `HOLDBACK_KEY`; no model key. |
| `read_file`, `write_file`, `list_files` | Inside the agent's own folder, never through a symbolic link |
| `wait`, `finish` | 1 to 30 s; end and report |

The keys stay out of the agents' reach:

- The buyer's key store sits in its company's folder, beside its own folder, where no file tool reaches.
- The seller's key lives only in its commands' environment.
- After every buyer command, the runner reads the key store and adds each key to the run's secret list.
- Every tool result passes through that list before a model or the record sees it, as do the record and the page. A secret is replaced wherever it appears, in hex, without `0x`, or in base64.

The system prompt tells each agent that everything a tool returns is data, whoever it claims to come from. A counterparty's words and a deliverable come back as tool results, never as system text.

**The approval stop.** The buyer's signer stops before it signs or pays. The company's policy answers that stop, not a person. The policy is set in `scenarios.ts`:

- a budget, everything included;
- the checks every offer must carry as required checks, as the company's own whole copy of each: the audit-report template's check, filled from the company's own scope. A check with the right name and other content is refused.
- every operator's clock and this machine's must agree within the band below, so one operator's clock never decides the dates;
- the latest delivery date the company accepts, as a distance from now (3 days), and how long judging may run after it (1 day): `deliverBy`, and every other deadline, must fall within them;
- a band around settlement time (600 s) that the offer's `createdAt` must fall inside, so a postdated offer cannot move every window.

- When the agent runs the approve line, the run tool checks the offer the stop showed against the policy.
- Within policy, the approve line runs. The record counts it as an approval pre-set by the company.
- Outside policy, the approve line is refused with the reasons and the dates. Measure 6 records that the agent asked to agree to terms its brief forbade.

**The engine.** Every run names its engine where a person reads it: the record's `world` line, `summary.json` (`engine`), and the first line of the page. A local run reads "the local simulator, phase-one rules (SimChain, chain 31337)". A testnet run names its chain and ID. A mainnet chain ID from the repository's list, or a world whose discovery names no chain, is refused before any agent starts.

**The docs.** A local world serves the site's `llms.txt` and `sell.txt` as the site's build publishes them (`site/build.mjs`), with one change: its own operators in place of `OP1` and `OP2`. The record's `world` line lists that change. Every stall is then a finding about the real docs, including where they describe the public test service and this run used the simulator.

## The record and the measures

`<run>/record.jsonl` holds one JSON line per event:

- every model turn: role, vendor, model ID, tokens in and out, cache reads, time, words and calls;
- every tool call: its input, its result and its size, with bodies trimmed past 4,000 characters;
- every refusal;
- every client command: its exit code and output;
- every API call the commands made (method, address, status, time), from a fetch hook preloaded into each command (`fetch-log.mjs`) that writes no header, query or body;
- every approval;
- each deal's chain events, with Sepolia Etherscan links on Sepolia.

`summary.json` holds the seven measures, computed from the record alone (`measures.ts`):

1. tokens for the deal and for each agent: fresh input, cache reads, cache writes and output apart; carrying Crow's guides against the work; the peak context (the largest input of one turn); and the list-price cost per agent and per deal for a live side;
2. turns, tool calls, commands, refusals and API calls;
3. stalls: the same failing call twice back to back (a wait between is polling, not a stall), or a cap hit, with the error text;
4. human interventions: the run takes no person's input, so 0. Approvals the company's policy answered are listed apart.
5. settlement-layer seconds from the decision that the work passes to the release. The local simulator settles both in the same second, so there the summary and the page say "not measured" instead of 0 s;
6. whether the buyer funded, or asked to approve, terms its brief forbade;
7. whether the run ended as the scenario says. No hold counts as right only when the buyer saw an offer and finished; two funded deals in one run count as wrong.

`replay.html` is one self-contained file generated from the record alone, built as a demo page that can be sent as it is (and later served at crow.direct/demo):

- **The demo view.** The header says "Crow" and "Buy from any agent. Sell to any agent.", with Learn more and Request early access. The early-access button goes to the sign-up form on crow.direct. A headline, "It's time to go direct.", and a short intro come next. Then the deal plays by itself in a messages window that scrolls itself, so the viewer watches without scrolling. The window shows the Enterprise Procurement Agent and the Enterprise Sales Agent, a typing indicator before each message, and the held payment in the middle. Its only label is "Sample Crow Test Demo", and its pause and replay buttons sit at its top right. It starts when it comes into view.
- **The Learn more view** holds everything else:
  - About, which is Rafa's five-beat pitch;
  - how the payment is held;
  - the purchase, and what each side paid and received;
  - the agreed checks, and what the two companies set in advance;
  - the full record step by step, with each exact call behind a disclosure;
  - the numbers;
  - the sources;
  - the engineers' section;
  - the honest lines: test money, a local setup or a test network, and real models or scripted stand-ins.
- **Words.** Protocol names appear only in the engineers' section and the exact calls; a test fails the page if its reader's text uses them. The words of the opening live in `HERO` and `PITCH` in `replay.ts`, so a change of words is one edit.
- **Opening the file.** It opens from disk with no server and loads nothing unless the reader clicks a link. The two views switch inside the file. It follows the system's light or dark appearance.

## Publishing the demo at crow.direct/demo

`pnpm duet publish <run folder>` writes `site/demo/index.html` from that run's record. `node site/build.mjs` publishes the file at `/demo/`, beside `/visualdemo/`. Crow's site deploys from `main`, so a new page goes live with the next site deploy, on Rafa's word. Swapping in another run, such as Rafa's first live run, is that one command and a pull request.

The published page differs from the local one in two ways:
- Request early access goes to the home page's own sign-up form (`/#join-form`): no new endpoint, and no new data.
- Every local path is cut to the run's own part, and every long hex string (deal IDs, addresses) is cut to its ends. The page then names no folder on this machine and carries nothing a secret scanner reads as a key.

The record's secret list has already been applied to everything on the page.

The early-access controls open the site's sign-up pop-up (`site/drawer.ts`) when scripts run, and fall back to that link when they do not.

## The demo page, for engineers

The demo page speaks plain words; its "For engineers" card under Resources links here. This section holds what the page's old "For engineers" section said (T-400).

**How the page is made.** It is generated from one run's `record.jsonl` alone, by `replay.ts`. `summary.json` beside the record holds the measures, and `ticket.md` the items over the limits when there are any. The page names the run's engine, code commit and order ID in one small line under Resources. The order's final state, the models, the docs served to the agents and the brief are all in the record's `run.start` and `world` lines. To make the published demo again:

```bash
pnpm duet run --scenario paid --buyer scripted --seller scripted
```

```bash
pnpm duet publish reports/scratch/duet/<the run folder>
```

**The plain words and the protocol terms behind them:**

| On the page | In the protocol |
| --- | --- |
| the held payment | the escrow hold |
| the independent reviewer | the adjudicator |
| the agreed checks | the terms' deterministic checks |
| signed | an EIP-712 signature |
| the report unlocking | the content key released with the payment |
| a payment record | a settlement transaction |
| no admin keys | the phase-one settlement contracts have no owner, pause, freeze, blacklist or upgrade proxy (CLAUDE.md, hard rules) |
| test dollars | the test token named in the demo deal's facts, with six decimals |

**The agents.** Each is a tool-use loop over its vendor's API with fenced tools: GET to an allowlist, a fixed list of the repository's client commands (`buy-with-signer`, `seller-adapter`, `check-delivery`, `seal`, `deal-record`), and files in its own folder. Keys stay in files and environments the agents cannot read. The seller's tool is `examples/seller-adapter.ts` and the buyer's is `examples/buy-with-signer.ts`; the company's standing approval rule answers the signer's approval stop.

## The mark

`crow-mark.svg` is Crow's mark on the demo page: a crow in flight, "as the crow flies", the direct way. It sits in the header and serves as the tab icon. Rafa supplied the image on 2026-11-12 for this use. It was traced into this one path, which is filled with the text's colour. If the image is redrawn or replaced, replace this file; the page reads the path from it.

## Limits and tickets

`limits.json` sets a limit for each measure in each scenario, peak context and cost per deal included. The limits are provisional. Paid's come from the first live baseline (2026-11-12: DeepSeek buying from Claude Opus, guided brief, 723,338 tokens, 89% of them cache reads, USD 0.43), at 1.5 times the busier agent. The other scenarios scale paid's by their scripted ratios, so they are still guesses. Retune them after more live runs and the first direct-brief runs.

The buyer starts once the seller's page is served, so the measures describe the deal, not a race to the seller's page. The record's `buyer.start` line gives the wait and whether the page was up.

An agent's token limit has two parts: Crow's guides read once, measured each run, plus an allowance for the work. With the short guides (T-393) they are about 6,985 tokens in all: `llms.txt` (the front page) 6,294 bytes, `buy.txt` 11,916 and `sell.txt` 9,729, at four bytes a token (measured 2026-11-12). A buyer reads the front page and `buy.txt`, a seller the front page and `sell.txt`; the reference pages under `ref/` are fetched one at a time when needed. The billed count carries the guides again on every turn after they are read, so a run goes over when carrying them costs more than the allowance, and the ticket says so with the split. In the scripted paid run, 27,426 of the buyer's 41,685 tokens carried the guides (124,025 of 138,989 before the short guides). `summary.json` gives each agent's `guides` and `work` tokens, and each guide's size.

When a run goes over a limit, or an agent stalls, the runner writes `ticket.md` beside the record, in plain words:

- each measure over its limit, with its number against the limit;
- where in the run it happened: the costliest turns, the most repeated calls, or the failing call with its error as the agent saw it;
- a likely cause. For tokens it names what the record shows: the pages on the docs' site read beyond the first-deal path (`llms.txt` and the role's own page), and the fetches that answered 404;
- a proposed owner: the docs, the API's errors, a client tool, the runner or the brief.

The command's last lines then print the ticket's path and "Send this ticket to the coordinator." With nothing over, the summary says so and there is no ticket.

## Against Sepolia

The phase-one contracts are live on Sepolia since 2026-11-13 (`contracts/deployments/sepolia.json`). A run against them is the next step: none is recorded yet [inferred from T-391's Handoff]. Expected changes, inferred and not yet run:

- Pass `--world` with the two operators. The docs then default to the public site's.
- The buyer's signer takes test funds from the test service's faucet itself.

Two things to check on the first run:

- Whether the faucet's grant (`demo.faucet.grant` in the test service's discovery) covers the job API stub's price plus the adjudication fee. The stub's price is in the brief's comment in `tools/duet/scenarios.ts`.
- That the seller page and the job API stay local. The buyer reaches them on 127.0.0.1, and the seller adapter listens there.

## Files

| File | What it holds |
| --- | --- |
| `duet.ts` | The command line |
| `run.ts` | One run: the world, both agents at once, the chain's account, the summary and the page |
| `loop.ts` | One agent's loop, caps, stall detection, system prompt |
| `providers.ts` | Anthropic, OpenAI-compatible and scripted providers; the pinned registry |
| `tools.ts` | The fenced tools and the company's approval policy |
| `world.ts` | The local phase-one world, the docs and seller page, the job API (`examples/seller-adapter-stub.ts`) |
| `scenarios.ts` | The three scenarios and the two companies' briefs |
| `scripted.ts` | The scripted agents the tests play |
| `record.ts`, `measures.ts`, `replay.ts` | The record and its secret list, the seven measures, the page |
| `limits.json`, `tickets.ts` | The limits for each scenario, and the ticket a run over them writes |
| `fetch-log.mjs` | The fetch hook preloaded into each client command |
| `duet.test.ts` | The four scenarios, the tools' limits (the red team's argument shift included), the policy's date band, the loop, the providers, the measures, the mainnet guard, a typecheck of this folder, and the command line, with no key |
