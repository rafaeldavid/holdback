# Update flow

A change to one part of Crow often means another part must change too. This page lists those parts (areas), the flows between them, and how each flow stays current. The founder console draws it as a graph and flags updates that may be owed.

## How to read it

- **Kinds.** Each flow has one kind:
  - **generated:** a script rebuilds the downstream area from the upstream one, and nobody edits the output by hand. The How column names the command.
  - **checked:** someone updates the downstream area, and a test or check fails while it is stale. The How column names the check.
  - **manual:** someone has to remember. These are the flows where drift happens.
- **One area per file.** A file belongs to the area whose path matches it most specifically: `site/llms.txt` is Agent docs, not Homepage and site.
- **Before you finish a change,** find each area it touches and follow that area's manual flows. Make those updates in the same pull request, or write them into the task's Handoff.
- **Preconditions are not flows.** A change to `spec/schemas/` needs an ADR and a version bump first (`CLAUDE.md`, "The contract").
- **Sources.** A generated or checked flow names the script or test that implements it, read from the code. A manual flow names the convention it comes from; "(inferred)" marks a flow that no doc states.
- **Changing this page.** The console parses both tables: keep their columns, put area IDs in From and To, and use one of the three kinds.

## Areas

| ID | Area | Paths | Outside the repository |
| --- | --- | --- | --- |
| contracts | Contracts | `contracts/src/`, `contracts/script/`, `contracts/lib/`, `contracts/deployments/sepolia.json` | The deployed contracts on Sepolia |
| abis | Generated ABIs | `packages/settlement/evm/abis.json`, `scripts/evm-abis.mjs` | |
| settlement | Settlement adapters | `packages/settlement/` | |
| api | API contract | `spec/`, `docs/api.md` | |
| workers | Operator and demo Workers | `apps/operator/`, `apps/demo-cloud/` | The two public operator nodes, api.escrow.stream and api2.escrow.stream |
| examples | Examples and the try bundle | `examples/`, `site/try.mjs` | escrow.stream/try.mjs |
| agentdocs | Agent docs | `site/llms.txt` | escrow.stream/llms.txt |
| homepage | Homepage and site | `site/`, `apps/site/`, `apps/early-access/` | escrow.stream, its problem pages and /visualdemo |
| quickstart | Quickstart | `docs/quickstart.md`, `tools/sim/README.md` | |
| ghdocs | GitHub docs | `README.md`, `SECURITY.md`, `CONTRIBUTING.md`, `LICENSE`, `.github/ISSUE_TEMPLATE/`, `.github/pull_request_template.md` | The repository's front page on GitHub |
| roadmap | Roadmap | `docs/plan.md`, `docs/backlog.md`, `docs/tasks/` | |
| decisions | Decisions | `docs/decisions-today.md`, `docs/decisions/` | |
| log | Daily log | `docs/log/` | |
| map | Design map | `scripts/design-map.mjs`, `tools/design-map/`, `tests/design-map.test.ts` | The page `pnpm map` writes (git-ignored), and the claude.ai design map page, which `/map` republishes |
| console | Founder console | | A private page built from the design map, the newest log, the task files, the radar's inputs and GitHub |
| stack | Contract-stack page | | The claude.ai contract-stack page |
| costs | Costs and telemetry | `scripts/costs/`, `tests/costs/`, `docs/costs.md`, `config/costs.template.json`, `config/keys-costs.template`, `apps/demo-cloud/src/telemetry.ts`, `apps/demo-cloud/src/feedback-store.ts`, `apps/demo-cloud/scripts/feedback.ts` | The cost collector's daily output, kept outside the repository |

## Flows

| From | To | Kind | How | Why |
| --- | --- | --- | --- | --- |
| contracts | abis | checked | Run `forge build`, then `node scripts/evm-abis.mjs`. `packages/settlement/evm/abis.test.ts` fails in CI's contracts job while `abis.json` differs from `contracts/out`. | A live chain is called through these ABIs; a stale copy encodes calls the deployed contracts do not take. |
| contracts | settlement | checked | CI's contracts job runs the anvil tests (`packages/settlement/evm`, the snap runner) against a fresh `forge build`, and fails if any test skips. | The EVM adapter mirrors the contracts' structs and calls by hand (`packages/settlement/evm/encode.ts`). |
| abis | settlement | checked | The same anvil tests: `packages/settlement/evm/live.ts` imports `abis.json`. | |
| contracts | examples | checked | Copy `contracts/deployments/sepolia.json` into `examples/deployments.ts` by hand. `examples/deployments.test.ts` (`pnpm test`) fails until they match. | An agent signs for the contracts that were deployed, and only those (T-213). |
| contracts | workers | generated | `pnpm -C apps/demo-cloud build` embeds `contracts/deployments/sepolia.json` (`apps/demo-cloud/scripts/embed.mjs`). It takes effect at the next deploy, which waits for Rafa. | The chain world settles on the recorded addresses (`apps/demo-cloud/src/worker.ts`). |
| contracts | api | manual | Update `docs/api.md`, and `spec/schemas/` if a message or a body changes. | Rafa, 2026-11-04: "if contracts are updated, then the API needs to be updated". The Sepolia cutover changed `docs/api.md` with the contracts (T-213). |
| contracts | stack | manual | Republish the claude.ai contract-stack page. | It lists the Sepolia contracts, their addresses and who can move money (inferred from the page's description). |
| contracts | ghdocs | manual | Update `README.md` (its intro and "Status") and `SECURITY.md` ("Scope"). | The README states where the demo settles and what is reviewed; `SECURITY.md` scopes `contracts/src/` and `contracts/deployments/`. |
| contracts | console | generated | The console's build reads `contracts/deployments/sepolia.json` and `contracts/src/` for its radar. | |
| settlement | workers | checked | `pnpm typecheck` and `pnpm test`: both apps import `@holdback/settlement`. | |
| api | workers | checked | `tests/contract/openapi.contract.test.ts` (`pnpm test`) checks every operator answer against `spec/openapi.json`. `pnpm validate:spec` fails while `spec/openapi.json` is stale; rebuild it with `pnpm openapi`. | `docs/team.md`, Rules and checks: "Operator answers match the contract". |
| api | examples | checked | The same contract test drives `examples/agent.ts` against the operators. | |
| api | agentdocs | manual | Write the change into `site/llms.txt`. `node site/check.mjs` then checks its routes, envelope test vectors and worked checks example against `docs/api.md`, but not new endpoints or prose. | `site/llms.txt` is the agent guide (`site/check.mjs`, group 4). |
| api | quickstart | manual | Update the curl walkthrough in `docs/quickstart.md`. | Tasks that change the API list `docs/quickstart.md` beside `docs/api.md` (T-020, T-024, T-025). |
| api | ghdocs | manual | Update `README.md` where it describes the API and the operator nodes. | Rafa, 2026-11-04: "if the API is updated", the GitHub docs follow. |
| api | map | generated | `pnpm map` reads the endpoint table and examples in `docs/api.md`, and the schema version in `spec/schemas/`. | `tests/design-map.test.ts` checks the extraction. |
| workers | agentdocs | checked | `node site/check.mjs`, group 5: every problem type in `apps/operator/src/problems.ts` needs its page, and `site/llms.txt` must say where they live. | D39. |
| workers | homepage | generated | `node site/build.mjs --out reports/site-out` writes one problem page per type in `apps/operator/src/problems.ts`. | |
| workers | ghdocs | manual | Update `SECURITY.md` ("Scope"), which names `apps/operator`, `apps/demo-cloud` and their hosts. | |
| workers | console | generated | The console's build reads each `wrangler*.jsonc`: Worker names and routes. | |
| examples | agentdocs | checked | `node site/check.mjs`, group 4: the EIP-712 types, the pinned domain and deployment, and the ERC-3009 types in `site/llms.txt` must equal `examples/verify.ts`. | |
| examples | homepage | checked | `site/index.html` shows the one command with the sha256 of `site/try.mjs`. `examples/try.test.ts` (`pnpm test`) and `node site/check.mjs` fail while either is stale; rebuild with `node site/build.mjs`. | `docs/team.md`, Rules and checks: "A published script is the code CI ran". |
| agentdocs | homepage | checked | `node site/build.mjs` renders `site/index.html` from `site/llms.txt`. `examples/try.test.ts` (`pnpm test`) and `node site/check.mjs` fail while it is stale. | One source for the page and the agent guide (`site/check.mjs`, group 1). |
| roadmap | map | generated | `pnpm map` reads the phases in `docs/plan.md` and each task file's status. | |
| decisions | roadmap | manual | Write a decision that changes scope, order or a phase into `docs/plan.md`, `docs/backlog.md` or the task files (inferred). | Rafa, 2026-11-04: a roadmap decision lives "only in the roadmap and crow-control". |
| decisions | map | generated | `pnpm map` reads `docs/decisions-today.md` and each ADR's status. | `tests/design-map.test.ts` checks every decision has a known status. |
| log | map | generated | `pnpm map` reads the newest log's "Waiting on Rafa". | |
| map | console | generated | The console's build calls the map's `collect()` and renders the map page beside it; it also reads the task files and the newest log directly. The claude.ai copy of the map is republished by hand with `/map`. | `docs/team.md`, Cadence: run `/map` at each milestone. |
| costs | console | generated | The console renders the cost collector's latest output (T-052); without one, it lists what each source needs. | |

## Two examples

- **A contracts change** reaches the ABIs, the settlement adapters, the examples and the Workers, each checked by CI. By hand, it reaches the API contract, the contract-stack page and the GitHub docs. Through the API contract it reaches the agent docs and the quickstart by hand, and the homepage through checked flows. The design map and the console rebuild on their own.
- **A roadmap decision** reaches only the roadmap (by hand), then the design map and the console, which rebuild.

## Not modeled yet

- Judgment (`packages/judgment/`, `apps/adjudicator/`, `config/judges*.yaml`), the core types and SDK (`packages/core/`, `packages/sdk/`), the agent rules and gates (`CLAUDE.md`, `AGENTS.md`, `.claude/`, `agent-ops/`), fixtures and snapshots, and the formal model.
- The console's radar and stream read every area's git history. Only flows that carry content are listed here.
