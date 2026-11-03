# T-039: Isolated development environment for the agents

- **Lane:** infra
- **Phase:** 9
- **Depends on:** nothing in the repository. Part (a) is Rafa's and can start before the rest of Phase 9, because it also ends the approval prompts on his laptop. Part (b) starts after part (a) step 1.
- **Paths this task may touch:** `scripts/dev-env/setup.sh` (new), `scripts/dev-env/gh-app-token.mjs` (new), `scripts/dev-env/smoke.mjs` (new), `tests/dev-env.test.ts` (new), `docs/dev-env.md` (new), `config/keys-dev-env.template`, `config/keys.template` (a pointer only), `.claude/settings.json` (the allow list only), `docs/operations.md` (Secrets; Working without permission prompts), `docs/tasks/T-039-isolated-dev-environment.md`
- **Human gate:** **yes.** Part (a) creates accounts, tokens, spending caps and repository settings, all outside the repository. Agents never create a credential or read its value.
- **Status:** todo
- **Agent/session:** —

## Intent

Agents work in an environment that holds nothing of Rafa's beyond what a task needs: no file from his laptop, no token for his personal accounts, every credential scoped to this repository or this project, every paid service behind a cap. The same environment ends the approval prompts that stopped work on 2026-10-31, 2026-11-01 and 2026-11-03.

- Inputs: `config/keys-dev-env.template`; the design's isolation rules (`agent-ops/pipeline.md`, Concurrency; threats P4, P6 and P9 in `agent-ops/gates.md`).
- Outputs: (a) an environment Rafa set up with scoped credentials; (b) a setup script, a smoke test that proves the scoping, and permission settings that keep sessions free of prompts.
- Non-goals: running the agent-ops pipeline (T-050), deploying anything, moving the live judges' keys (they stay Worker secrets on Cloudflare).

## The choice: Claude Code cloud or a VM

Facts below were read from the vendors' documentation on 2026-11-03 (documented) unless marked inferred.

| | A. Claude Code cloud environment | B. A VM, for example exe.dev |
| --- | --- | --- |
| Rafa's time before build sessions start | About 1 hour (guessed) | About 2 hours (guessed) |
| Cost | Included in the Claude plan; sessions share its usage limits | exe.dev Personal plan from USD 15 a month (2 vCPU, 4 GB); more for larger VMs |
| GitHub access | Through the Claude GitHub App and a proxy; credentials never enter the VM | A token or GitHub App key stored on the VM |
| Whose name is on commits and PRs | Rafa's GitHub account | The agents' own identity (step 3) |
| Tier 3 review enforceable | No. Rafa cannot approve a PR his own account opened. | Yes, with the agents' own identity |
| Approval prompts | Modes are Accept edits, Plan and Auto; Bypass is not offered. Few prompts expected (inferred). | Bypass mode, which Claude Code's docs allow only in an isolated container or VM: no prompts |
| Secrets | Environment variables are visible to every user of the environment. Network secrets keep a key out of the VM, except for api.anthropic.com and GitHub. | exe.dev Integrations inject a key at the network edge, so the VM never reads it (exe.dev docs) |
| Known limits | `gh pr` and other GraphQL commands answer 403 (use `gh api` REST); the proxy refuses branch deletions; Foundry is not preinstalled | Rafa maintains the VM |

**Recommendation: B, a VM with the agents' own GitHub App identity.** It is the only option that meets all three needs:

1. no approval prompts;
2. GitHub can tell the agents' work from Rafa's (tier 3 review and threat P9 need this);
3. keys stay out of reach.

A is a sound quick start for build sessions before activation. The steps below mark what differs: **[A]**, **[B]** or **[both]**.

## Two kinds of session

The design gives build agents no model, Cloudflare or chain keys (P4). So the environment has two secret sets:

- **Build sessions**, used for every task, read and write this repository and hold nothing else.
- **Deploy sessions**, used only on Rafa's go-ahead (`docs/operations.md`), add the Cloudflare token, the Sepolia deployer key and the Etherscan key.

On A, the two sets are two environments. On B, they are two Unix users, `agent` and `deploy`.

## Where each credential lives

| Credential | Build | Deploy | GitHub Actions secret | Cloudflare Worker secret | Rafa's laptop only |
| --- | --- | --- | --- | --- | --- |
| The agents' GitHub identity (App key, or the cloud proxy) | yes | yes | — | — | — |
| Rafa's GitHub login, 2FA and recovery codes | — | — | — | — | yes |
| Cloudflare API token (Workers, KV, routes) | — | yes | — | — | — |
| Cloudflare login (account owner) | — | — | — | — | yes |
| Live judges' keys (Anthropic, DeepSeek) | — | — | — | yes, today | yes, in `.env` |
| The agents' own Anthropic key (live triager, `pnpm demo --live`) | only for a task that names it | — | — | — | — |
| Cross-family review keys (DeepSeek, GPT) | — | — | yes, at T-050 | — | — |
| Stripe `sk_test_` key | when the Phase 5 on-ramp task starts | — | — | — | — |
| Sepolia deployer key | — | yes | — | — | — |
| Sepolia relayer keys | — | — | — | yes (`holdback-op1`) | — |
| Sepolia funding wallet | — | — | — | — | yes |
| Etherscan API key | — | yes | — | — | — |
| Prividium registry login (T-208, parked) | — | — | — | — | yes |

## Part (a): Rafa's steps

Every step is **human**. Times are guessed; faucet waits are extra.

1. **Choose A or B** (10 min) [both]. Read the table above and write the choice in Handoff. On B, sign up at https://exe.dev (run `ssh exe.dev` to register; docs at https://exe.dev/docs) or use a VM provider you already have. Pick at least 4 vCPU and 8 GB, since `pnpm verify` runs forge's compile next to vitest (guessed).

2. **Harden your own GitHub account first** (15 min) [both].
   - Two-factor authentication: https://github.com/settings/security, then Enable two-factor authentication. Store the recovery codes in your password manager.
   - Fine-grained tokens: https://github.com/settings/personal-access-tokens. Delete any you do not use. Set the rest to expire.
   - Classic tokens: https://github.com/settings/tokens. Delete any you do not use.
   - Authorized OAuth apps: https://github.com/settings/applications. Revoke the ones you do not recognise.
   - Installed GitHub Apps: https://github.com/settings/installations. Open Claude, choose Configure, and set Repository access to Only select repositories: `holdback`.
   - Security log: https://github.com/settings/security-log. Look for `personal_access_token` and `oauth_authorization` events you did not cause.
   - On A, do not run `/web-setup` in the terminal. It sends your personal `gh` token to the cloud.

3. **Create the agents' own GitHub identity** (20 min) [B].
   1. Go to https://github.com/settings/apps/new.
   2. Fill in the basics:
      - GitHub App name: `crow-agents`.
      - Homepage URL: https://escrow.stream.
      - Webhook: clear Active.
      - Where can this GitHub App be installed: Only on this account.
   3. Repository permissions:
      - Contents: Read and write.
      - Pull requests: Read and write.
      - Actions: Read-only.
      - Workflows: Read and write. Leave it at No access if agents should never edit `.github/workflows/`.
      - Variables: Read-only, so the tick can read `AGENT_OPS` but never change it.
      - Commit statuses, Administration and Secrets: No access, so agents can neither forge a status nor change settings.
   4. Create the app. Under Private keys, choose Generate a private key. Note the App ID.
   5. On the app's page, choose Install App, then Only select repositories: `holdback`. Note the installation ID, the number at the end of the installation's URL.

   Installation tokens last one hour; part (b) step 2 mints them.

   Fallback if you prefer a person-like account: a machine user (GitHub's Terms allow one free machine account besides your own) added as a collaborator with Write on `holdback`. It needs a classic token with `public_repo` and `workflow` scopes, because a fine-grained token cannot write to a repository whose owner is a personal account where the token's owner is only a collaborator (GitHub docs, "Fine-grained personal access tokens limitations").

   Fastest, but weakest: a fine-grained token on your own account, limited to `holdback` (as `config/keys-dev-env.template` describes today). It acts as you, so tier 3 review stays unenforceable.

4. **Check the `main` ruleset's bypass list** (2 min) [both]. Open https://github.com/rafaeldavid/holdback/settings/rules, open `main`, and confirm the Bypass list is empty. It was empty when measured on 2026-11-02. A bypass actor's pushes skip the rules, including pushes made through Claude's GitHub access.

5. **Create the Cloudflare token for deploy sessions** (15 min) [both].
   1. Go to https://dash.cloudflare.com/profile/api-tokens and choose Create Token, then Custom token. Name it `crow-deploy`.
   2. Permissions:
      - Account · Workers Scripts · Edit.
      - Account · Workers KV Storage · Edit.
      - Account · Account Settings · Read.
      - Account · Workers Tail · Read.
      - Zone · Workers Routes · Edit.

      The last two are inferred from wrangler's "Edit Cloudflare Workers" template: wrangler needs them for `wrangler tail` and the custom domains.
   3. Account Resources: Include your account. Zone Resources: Include, Specific zone, `escrow.stream`.
   4. Client IP Address Filtering, on B: Is in, the VM's outbound IP.
   5. TTL: an end date 90 days out.
   6. Copy the token once. Also copy the account ID from the dashboard's account home page.

6. **Set Cloudflare budget alerts** (5 min) [both]. Go to Manage Account, then Billing, then Billable Usage, and choose Create budget alert at USD 10 and USD 25. Alerts email you but never stop usage, and Workers Paid has no spend cap. The per-Worker CPU limit (Workers & Pages, the Worker, Settings, CPU Limits) is the only brake.

7. **Create model-provider keys apart from the judges' keys** (20 min).
   - **Anthropic** [both]: go to https://platform.claude.com/settings/workspaces (console.anthropic.com redirects there).
     1. Choose Create workspace and name it `crow-agents`.
     2. Under Spend limits, Monthly limit, choose Change limit. USD 50 is a guess; the Default workspace cannot hold a limit.
     3. Choose Add notification at 50% and 80% of the limit.
     4. At https://platform.claude.com/settings/keys, choose Create key in `crow-agents`, with an expiry of 30 days or a custom date.

     At the limit, the API refuses further requests.
   - **DeepSeek**: https://platform.deepseek.com/api_keys. DeepSeek has no spend limit, only a prepaid balance that every key in the account shares (inferred), so the balance is the cap. Keep it small, for example USD 10, and top up by hand at https://platform.deepseek.com/top_up. For a cap separate from the judges', open a second DeepSeek account. You need this key at T-050; it is not needed now.
   - **OpenAI**, for the GPT fallback reviewer, once T-040 pins a model: create a project named `crow-review`. In its Limits, choose Edit spend limit, then Monthly spend limit, then Enforce a hard limit. The settings start at https://platform.openai.com/settings/. Without Enforce a hard limit, the limit only alerts.

8. **Stripe test keys: only when the Phase 5 on-ramp task starts** (5 min) [both]. Create a sandbox from the account picker (Sandboxes) and copy its secret key from https://dashboard.stripe.com/apikeys. It must start with `sk_test_`. A restricted `rk_test_` key is refused by the startup guard (hard rule "No real money"). Skip this step now.

9. **Sepolia wallets and funding** (30 min, plus days of faucet waits) [both]. Do this on your laptop, not in an agent session, because each command prints a private key.
   1. Run `cast wallet new` once for the deployer, once for a funding wallet, and once for each relayer key that the Sepolia demo work asks for. Its research proposes three relayer lanes and a faucet lane (`docs/research/2026-11-03-sepolia-demo-settlement.md`, in progress).
   2. Fund the funding wallet from the faucets:
      - https://cloud.google.com/application/web3/faucet/ethereum/sepolia (about 0.05 ETH a day, inferred);
      - https://www.alchemy.com/faucets/ethereum-sepolia (0.1 ETH every 24 hours; needs 0.001 ETH on mainnet);
      - https://sepolia-faucet.pk910.de/ (proof of work; 0.05 to 2.5 ETH a session, inferred).

      That research puts 0.25 ETH as enough to launch and 1.2 ETH as about 1,600 deals (guessed). Send the deployer about 0.1 ETH (guessed).
   3. Store the relayer keys as Worker secrets on `holdback-op1`, with `npx wrangler@4 secret put RELAYER_KEYS --config apps/demo-cloud/wrangler.op1.jsonc`. It reads the value from the prompt and prints nothing. Use the variable name the Sepolia task settles on.
   4. Optional: an Etherscan API key at https://etherscan.io/myapikey, for source verification. The free tier allows 3 calls a second and 100,000 a day.

10. **Store the secrets in the environment** (20 min).
    - [A] At https://claude.ai/code, open the environment selector under the message box, then choose New environment.
      - **`crow-build`**:
        - Network access: Custom, with "Also include default list of common package managers" ticked, plus `foundry.paradigm.xyz` (inferred: foundryup's host).
        - No environment variables.
        - Setup script: `bash scripts/dev-env/setup.sh` (it runs after the repository is cloned; inferred).
      - **`crow-deploy`**:
        - The same network list, plus `api.cloudflare.com`, `ethereum-sepolia-rpc.publicnode.com`, `sepolia.gateway.tenderly.co` and `api.etherscan.io`.
        - Environment variables: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `TESTNET_DEPLOYER_PRIVATE_KEY`, `CHAIN_ID=11155111`, `CHAIN_RPC_URL` and `ETHERSCAN_API_KEY`. They are visible to anyone who uses the environment, and only you do.
    - [B] Create the VM with two users, `agent` and `deploy`.
      - Model keys go in exe.dev Integrations, so the VM uses them without reading them (https://exe.dev/docs/integrations).
      - The GitHub App's ID, installation ID and private key go in `/home/agent/.config/crow/env`, mode 600.
      - The deploy secrets go in `/home/deploy/.config/crow/env`, mode 600.
      - Each user's login shell loads its file.
      - Sign Claude Code in to your plan with `claude` and then `/login` as each user, or set `ANTHROPIC_API_KEY` to the `crow-agents` key from step 7 for a separate, capped bill.
      - Turn on Remote Control, so you can watch and steer the sessions from the Claude app instead of your laptop's terminal.

11. **Review the caps in one place** (10 min) [both]. Confirm each of these:
    - Anthropic `crow-agents`: a monthly limit and two notifications.
    - DeepSeek: a small balance.
    - OpenAI: a hard limit, once the project exists.
    - Cloudflare: two budget alerts and CPU limits.
    - GitHub Actions: free for this public repository; at https://github.com/settings/billing, keep the spending limit for paid features at USD 0.
    - The VM plan: a fixed price.
    - On A: cloud sessions draw on the Claude plan's usage.

12. **Decide what stays on your laptop** (10 min) [both]. The proposal:
    - your GitHub, Cloudflare, Anthropic and Claude owner logins;
    - recovery codes and the password manager;
    - the Sepolia funding wallet;
    - the `.env` with the judges' keys;
    - the Prividium login;
    - the coordinator session you talk to.

    Build and deploy sessions move to the environment once the smoke test passes. Write the decision in Handoff.

13. **Write down the sever list** (5 min) [both]. If anything goes wrong, these stop every agent:
    - suspend the `crow-agents` installation at https://github.com/settings/installations;
    - delete `crow-deploy` at https://dash.cloudflare.com/profile/api-tokens;
    - delete the `crow-agents` key at https://platform.claude.com/settings/keys;
    - delete the DeepSeek and OpenAI review keys;
    - stop the VM (B) or archive the environments (A).

14. **Give the go-ahead for part (b)** (1 min). Write it in Handoff with the date.

When each step is needed:

- **Before build sessions start:** steps 1, 2, 3 (B only), 4, 10 (the build environment or user), 12, 13 and 14. About 1 hour on A, about 2 hours on B (guessed).
- **Before the first deploy from the environment:** steps 5, 6, 9 and 10 (the deploy side). About 1.5 hours, plus faucet waits.
- **At T-050:** the DeepSeek and OpenAI keys in step 7, and step 11.
- **At the Phase 5 on-ramp:** step 8.

## Part (b): the agents' steps

Every step is **agent** unless marked. Times are guessed.

1. **`scripts/dev-env/setup.sh`** (2 hours). It is idempotent, needs no secret and prints only tool versions. It works as the cloud setup script and on the VM. It:
   - checks Node 22.18 or later;
   - enables pnpm 12.16.1 through corepack;
   - runs `pnpm install --frozen-lockfile`;
   - installs Foundry at the version CI pins (`v1.0.0`, `.github/workflows/ci.yml`) and initializes `contracts/lib/` submodules;
   - installs gitleaks;
   - installs Java 21 only when `--formal` is passed;
   - points `TMPDIR`, `FOUNDRY_DIR` and the pnpm store under `reports/`.

   It exits non-zero on any failure, because a cloud setup script must exit 0 or the session fails.
2. **`scripts/dev-env/gh-app-token.mjs`** [B] (2 hours). It mints a one-hour installation token from the App ID, installation ID and private key, and serves it to git as a credential helper and to `gh` through a wrapper. It never writes the token to a file or a log. Tests use a throwaway key.
3. **`docs/dev-env.md`** (1 hour). It covers:
   - how to start a build and a deploy session on A and on B;
   - which secrets each holds (the table above);
   - Remote Control;
   - how to stop everything (the sever list);
   - the cloud's limits: `gh pr` answers 403, so use `gh api` REST calls; branch deletion is refused.

   It also flags that T-036's `/merge-pr` and T-047's `stop.mjs` need REST and no-deletion paths there.
4. **`config/keys-dev-env.template`** (30 min). Split it into build and deploy sections with every variable named above. Correct the console URL (platform.claude.com). Say that a fine-grained token cannot write as a collaborator. Name exe.dev Integrations. `config/keys.template` gets a one-line pointer.
5. **Permission settings that avoid prompts** (1 hour).
   - On B, sessions run as the non-root `agent` user with `claude --dangerously-skip-permissions`, which Claude Code's docs allow in an isolated VM and refuse as root.
   - On A, sessions use Auto mode where offered, else Accept edits. The allow list in `.claude/settings.json` keeps every command in `CLAUDE.md`'s verify list. `.claude/settings.local.json` does not apply in cloud sessions.
   - The deny rules (`.env*`, force pushes, `forge script`, `cast send`) stay everywhere. The smoke test checks that they still bind in bypass mode (inferred, to measure).
   - Laptop sessions keep the rules in `docs/operations.md`.
6. **`scripts/dev-env/smoke.mjs`** (3 hours). It prints each check's name and result, never a value:
   - **Identity:** `gh api` reports the agents' identity, not `rafaeldavid` (B). On A, it reports Rafa's account through the proxy, as a known limit.
   - **Reach:** `gh api /repos/rafaeldavid/holdback` shows `push: true`; the same read on another of Rafa's repositories shows no push permission; an App token lists only `holdback`.
   - **No personal files:** no private key in `~/.ssh`, no `~/.aws`, `~/.config/gcloud` or token-bearing `~/.npmrc`, and no `.env` at the repository root in a build session. Checked by existence only, never read.
   - **Environment variable names:** they match the session type's list exactly. Any other name ending in `_KEY`, `_TOKEN` or `_SECRET` fails.
   - **Deploy only:** Cloudflare's `GET /client/v4/user/tokens/verify` answers active; the chain ID is 11155111 or 31337, never 1; the RPC's `eth_chainId` agrees.
   - **If set:** the Stripe key starts with `sk_test_`.
   - **Deny rules:** a read of `.env` is refused.
7. **Prove nothing reaches Rafa's accounts** (human, 10 min). After the smoke test passes in both session types:
   - Rafa checks https://github.com/settings/security-log for token use he did not cause;
   - he checks that Anthropic usage appears only under `crow-agents`;
   - he checks that Cloudflare's audit log shows only `crow-deploy` activity from the environment.

   He records the result in Evidence.

## Acceptance criteria

- [ ] Rafa's steps for build sessions (1, 2, 3 on B, 4, 10, 12, 13, 14) are done, each ticked in Handoff with the date (human). The deploy steps follow before the first deploy from the environment.
- [ ] `pnpm vitest run tests/dev-env.test.ts` passes, covering the setup script's checks, the token minter on a throwaway key and the smoke test's parsing, with no network.
- [ ] `node scripts/dev-env/smoke.mjs` passes in a build session and in a deploy session; its report is pasted in Evidence (measured).
- [ ] A build session runs `pnpm verify` end to end with no approval prompt (measured: the transcript shows none).
- [ ] Part (b) step 7 is recorded in Evidence (human).

## Out of scope

- The pipeline's own keys and settings at activation (T-050), the live demo's Worker secrets beyond the relayer keys, mainnet anything.

## Evidence

## Decisions

- The vendor facts in this file were read on 2026-11-03 by two research passes (Claude Code docs; GitHub, Anthropic, DeepSeek, OpenAI, Cloudflare, Stripe, Etherscan and exe.dev docs). Recheck a URL if a page has moved.

## Handoff
