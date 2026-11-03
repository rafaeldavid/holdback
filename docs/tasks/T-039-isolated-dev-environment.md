# T-039: Isolated development environment for the agents

- **Lane:** infra
- **Phase:** 9
- **Depends on:** nothing in the repository. Rafa can start part (a) before the rest of Phase 9, because the environment also ends the approval prompts on his laptop. Part (b) steps 1 to 3 hold no secret, so agents can build them anywhere; Rafa's VM steps run them.
- **Paths this task may touch:** `scripts/dev-env/setup.sh` (new), `scripts/dev-env/vm-users.sh` (new), `scripts/dev-env/gh-app-token.mjs` (new), `scripts/dev-env/smoke.mjs` (new), `tests/dev-env.test.ts` (new), `docs/dev-env.md` (new), `config/keys-dev-env.template`, `config/keys.template` (a pointer only), `.claude/settings.json` (the allow list only), `docs/operations.md` (Secrets; Working without permission prompts), `docs/tasks/T-039-isolated-dev-environment.md`
- **Human gate:** **yes.** Part (a) creates accounts, tokens, spending caps and repository settings, all outside the repository. Agents never create a credential or read its value.
- **Status:** todo
- **Agent/session:** —

## Intent

Agents work in an environment that holds nothing of Rafa's beyond what a task needs:

- no file from his laptop;
- no credential for his personal accounts that an agent can read;
- every credential scoped to this repository or this project;
- every paid service behind a cap.

The same environment ends the approval prompts that stopped work on 2026-10-31, 2026-11-01 and 2026-11-03.

- Inputs: `config/keys-dev-env.template`, the design's isolation rules.
- Outputs: (a) an environment Rafa set up with scoped credentials; (b) the scripts that set it up and prove the scoping, and the permission settings that keep sessions free of prompts.
- Non-goals: running the agent-ops pipeline (T-050), deploying anything, moving the live judges' keys (they stay Worker secrets on Cloudflare).

## Context

- `agent-ops/pipeline.md` (Concurrency), and threats P4, P6 and P9 in `agent-ops/gates.md` (PR 112, not merged yet).
- `docs/operations.md`: Secrets, Deploy, Gates, and Working without permission prompts.
- `CLAUDE.md` hard rules: secrets come from environment variables only, never read or print `.env*`, no real money. The Stripe startup guard accepts only `sk_test_` keys.
- Already in place (2026-11-03):
  - The Sepolia relayer key is the Worker secret `SEPOLIA_RELAYER_KEY` on `holdback-op1`, made by `apps/demo-cloud/scripts/relayer.mjs` without being printed (T-213).
  - The Sepolia deployer is an encrypted Foundry keystore on Rafa's laptop (T-206, PR 128).
- Vendor facts below were read on 2026-11-03 from the Claude Code, GitHub, Anthropic, DeepSeek, OpenAI, Cloudflare, Stripe, Etherscan and exe.dev docs. They are marked documented, or inferred where a page did not say it.

## The choice: Claude Code cloud or a VM

| | A. Claude Code cloud environment | B. A VM, for example exe.dev |
| --- | --- | --- |
| Rafa's time before build sessions start | About 45 minutes (guessed) | About 2 hours (guessed) |
| Cost | Included in the Claude plan; sessions share its usage limits | exe.dev Personal plan from USD 15 a month for 2 vCPU and 4 GB; a 4 vCPU, 8 GB VM costs more (https://exe.dev/pricing). Claude Code runs on a capped API key, billed per token. |
| GitHub access | The Claude GitHub App through a proxy. Credentials never enter the VM (documented). | The agents' own GitHub App. Its key stays with a user the agents cannot read (part (b) step 2). |
| Whose name is on commits and PRs | Rafa's GitHub account | `crow-agents[bot]` |
| Tier 3 review enforceable | No. GitHub does not let an author approve their own PR (documented). | Yes |
| Approval prompts | Modes are Accept edits, Plan and Auto; Bypass is not offered (documented). Few prompts expected (inferred). | None: bypass mode, which Claude Code allows in an isolated VM and refuses as root (documented) |
| Known limits | `gh pr`, `gh issue` and other GraphQL commands answer 403, so scripts must use `gh api` REST calls (documented). Auto-merge can be armed only through GraphQL, so `/merge-pr` cannot arm it (inferred). The proxy refuses branch deletions (documented). Foundry is not preinstalled. | Rafa maintains the VM. A push that changes `.github/workflows/` is refused (step 3), including a merge of `main` that brings a workflow change (inferred). Rafa updates such a branch, or the agent restarts it from `main`. |

**Recommendation: B, a VM with the agents' own GitHub App.** It is the only option that meets all three needs:

1. no approval prompts;
2. GitHub tells the agents' work from Rafa's, which tier 3 review and threat P9 need;
3. no agent can read a key that outlives one hour.

A is a sound quick start for build sessions before activation. A third option, Claude Code's self-hosted environments, is for Team and Enterprise plans only (documented).

## Two kinds of session

The design gives build agents no model, Cloudflare or chain keys (P4). So the environment has two secret sets.

- **Build sessions**, used for every task, read and write this repository and hold nothing else. On B, they also hold the capped key Claude Code itself runs on.
- **Deploy sessions** add the Cloudflare token. They run only on Rafa's go-ahead (`docs/operations.md`).

On A, the two sets are two environments. On B, they are two Unix users, `agent` and `deploy`. A third user, `minter`, holds the GitHub App key.

## Where each credential lives

| Credential | Build | Deploy | GitHub (Actions or Environment) | Cloudflare Worker secret | Rafa's laptop only |
| --- | --- | --- | --- | --- | --- |
| GitHub App private key (B) | — (one-hour tokens through `minter`) | — (the same) | — | — | backup in his password manager |
| Rafa's GitHub login, 2FA and recovery codes | — | — | — | — | yes |
| Anthropic `crow-agents` key, capped (Claude Code on B; live triager runs) | yes (B) | yes (B) | — | — | — |
| Cloudflare API token `crow-deploy` | — | yes | — | — | — |
| Cloudflare login (account owner) | — | — | — | — | yes |
| Live judges' keys (Anthropic, DeepSeek) | — | — | — | yes, today | yes, in `.env` |
| Cross-family review keys (DeepSeek, GPT), capped | only the one session Rafa approves for a live test run (T-045, T-046) | — | an Environment limited to `main`, at T-050 | — | — |
| Stripe `sk_test_` key | when the Phase 5 on-ramp task starts | — | — | — | — |
| Sepolia relayer key `SEPOLIA_RELAYER_KEY` | — | — | — | yes (`holdback-op1`) | — |
| Sepolia deployer keystore (T-206) | — | — | — | — | yes |
| Etherscan API key | — | yes | — | — | — |
| Prividium registry login (T-208, parked) | — | — | — | — | yes |

No personal Claude login or Remote Control runs on the VM: the `crow-agents` key is the only Anthropic credential there. Rafa follows the work through PRs and the daily log. To watch a live session, he connects with `ssh` and attaches to its `tmux` session.

## Part (a): Rafa's steps

Every step is **human**. Times are guessed; faucet waits are extra. The steps are in the order to do them. Tags mark which option a step belongs to: **[A]**, **[B]** or **[both]**.

### Before build sessions start

1. **Choose A or B** (10 min) [both]. Read the table above and write the choice in Handoff.

2. **Harden your own GitHub account** (15 min) [both].
   - Two-factor authentication: https://github.com/settings/security, then Enable two-factor authentication. Keep the recovery codes in your password manager.
   - Fine-grained tokens: https://github.com/settings/personal-access-tokens. Delete unused ones. Set the rest to expire.
   - Classic tokens: https://github.com/settings/tokens. Delete unused ones.
   - Authorized OAuth apps: https://github.com/settings/applications. Revoke what you do not recognise.
   - Installed GitHub Apps: https://github.com/settings/installations. Open Claude, choose Configure, and set Repository access to Only select repositories: `holdback`.
   - Security log: https://github.com/settings/security-log. Look for `personal_access_token` or `oauth_authorization` events you did not cause.
   - On A, do not run `/web-setup`. It sends your personal `gh` token to the cloud.

3. **Create the agents' GitHub App** (20 min) [B].
   1. Go to https://github.com/settings/apps/new.
   2. Fill in the basics:
      - GitHub App name: `crow-agents`.
      - Homepage URL: https://escrow.stream.
      - Webhook: clear Active.
      - Where can this GitHub App be installed: Only on this account.
   3. Repository permissions:
      - Contents: Read and write.
      - Pull requests: Read and write.
      - Actions: Read and write. Rerunning a failed job needs it (documented). It also lets an agent cancel or disable a workflow, which fails closed, because a required check that never reports blocks the merge (inferred).
      - Issues: Read-only.
      - Variables: Read-only, so the tick can read `AGENT_OPS` and never change it.
      - Workflows: **No access.** With write access, a branch push could add an `on: push` workflow that posts `check`, `gitleaks` or `xreview` as passing and reads repository secrets.
      - Commit statuses, Secrets, Environments and Administration: No access.
   4. Create the app. Note the App ID. Under Private keys, choose Generate a private key, and store the downloaded `.pem` in your password manager.
   5. On the app's page, choose Install App, then Only select repositories: `holdback`. Note the installation ID, the number at the end of the installation's URL.

   Fallback, if you prefer a person-like account: a machine user (GitHub's Terms allow one free machine account besides your own) added as a collaborator with Write on `holdback`. It needs a classic token with the `public_repo` scope and without `workflow`. A fine-grained token cannot write to a personal account's repository as a collaborator (documented).

4. **Check the repository's Actions and ruleset settings** (5 min) [both].
   - https://github.com/rafaeldavid/holdback/settings/actions: under Workflow permissions, choose "Read repository contents and packages permissions", and clear "Allow GitHub Actions to create and approve pull requests".
   - https://github.com/rafaeldavid/holdback/settings/rules: open `main` and confirm its Bypass list is empty (measured empty on 2026-11-02). Your own bypass, for tier 3 PRs, goes in a separate ruleset at T-050, so `check` and `gitleaks` stay required for everyone.

5. **Create the capped Anthropic workspace and key** (10 min) [B; A only for a live triager run]. Go to https://platform.claude.com/settings/workspaces (console.anthropic.com redirects there).
   1. Choose Create workspace and name it `crow-agents`.
   2. Under Spend limits, choose Change limit for the Monthly limit. USD 100 is a guess. The Default workspace cannot hold a limit (documented).
   3. Choose Add notification at 50% and at 80%.
   4. At https://platform.claude.com/settings/keys, choose Create key in `crow-agents`, with a 30-day or custom expiry.

   At the limit, the API refuses requests and sessions stop: that is the cap working.

6. **Set up the VM** (45 min) [B]. Part (b) steps 1 to 3 must be merged first.
   1. Create a VM with at least 4 vCPU and 8 GB. On exe.dev: `ssh exe.dev` to register, then `ssh exe.dev new --name crow`, with the size per https://exe.dev/docs.
   2. On the VM, run `git clone https://github.com/rafaeldavid/holdback.git`, then `sudo bash holdback/scripts/dev-env/vm-users.sh`. It creates the `agent`, `deploy` and `minter` users, their folders, the minter rule and the root-owned copy of the token script. It holds no secret.
   3. Paste the App key. On your Mac, run `pbcopy < ~/Downloads/<the-key>.pem`. On the VM, run `sudo -u minter sh -c 'umask 077; cat > /home/minter/.config/crow/app.pem'`, paste, and press Ctrl-D. Then delete the downloaded file.
   4. Run `sudo -u minter sh -c 'umask 077; cat > /home/minter/.config/crow/app.env'`, type `APP_ID=<id>` and `INSTALLATION_ID=<id>` on two lines, and press Ctrl-D.
   5. Give Claude Code its key. If exe.dev's Integrations can inject it at the network edge (https://exe.dev/docs/integrations; whether Claude Code works that way is inferred), use that. Otherwise run `sudo -u agent sh -c 'umask 077; cat > /home/agent/.config/crow/env'`, type `ANTHROPIC_API_KEY=<the crow-agents key>`, and press Ctrl-D. The agent can then read this key; the workspace limit bounds the loss.
   6. Do not run `/login` and do not turn on Remote Control on the VM.

7. **Create the build environment** (15 min) [A]. At https://claude.ai/code, open the environment selector under the message box and choose New environment.
   - Name: `crow-build`.
   - Network access: Custom, with "Also include default list of common package managers" ticked, plus `foundry.paradigm.xyz` (inferred: foundryup's host).
   - No environment variables.
   - Setup script: `bash scripts/dev-env/setup.sh` (it runs after the clone; inferred).

8. **Write down the sever list** (5 min) [both]. Note how to revoke each credential that exists, and add a line whenever you create another:
   - B: suspend the `crow-agents` installation at https://github.com/settings/installations.
   - B: delete the `crow-agents` key at https://platform.claude.com/settings/keys.
   - B: stop the VM. A: archive the environments.

9. **Decide what stays on your laptop** (10 min) [both]. The proposal:
   - your GitHub, Cloudflare, Anthropic and Claude logins;
   - recovery codes and the password manager;
   - the Sepolia deployer keystore and the `.env` with the judges' keys;
   - the Prividium login;
   - the coordinator session you talk to.

   Build sessions move to the environment once the smoke test passes. Write the decision in Handoff.

10. **Give the go-ahead for part (b) steps 4 to 7** (1 min). Write it in Handoff with the date.

### Before the first deploy from the environment

11. **Create the Cloudflare token for deploy sessions** (15 min) [both].
    1. Go to https://dash.cloudflare.com/profile/api-tokens and choose Create Token, then Custom token. Name it `crow-deploy`.
    2. Permissions:
       - Account · Workers Scripts · Edit.
       - Account · Workers KV Storage · Edit.
       - Account · Account Settings · Read.
       - Account · Workers Tail · Read.
       - Zone · Workers Routes · Edit.

       The last two are inferred from wrangler's "Edit Cloudflare Workers" template: `wrangler tail` and the custom domains need them.
    3. Account Resources: Include your account. Zone Resources: Include, Specific zone, `escrow.stream`.
    4. On B, set Client IP Address Filtering to Is in, the VM's outbound IP.
    5. TTL: an end date 90 days out.
    6. Copy the token once, and the account ID from the account home page. Add the token to the sever list.

12. **Cloudflare budget alerts: only on Workers Paid** (5 min) [both]. `docs/operations.md` describes the Free plan, and another session reported a move to Paid on 2026-11-02. Check under Workers & Pages, then Plans.
    - On Paid: Manage Account, then Billing, then Billable Usage, then Create budget alert at USD 10 and USD 25. Alerts email you but never stop usage, and Workers Paid has no spend cap. The per-Worker CPU limit is the only brake.
    - On Free: skip this step. The Free plan's daily limits are the cap.

13. **Fund the Sepolia accounts** (10 min, plus days of faucet waits) [both].
    - Send faucet ETH to the relayer's funding lane, `0x601137a8DE7E195E1426f57C053aFa49B20Ef555` (`docs/operations.md`), and to the T-206 deployer address. Faucets:
      - https://cloud.google.com/application/web3/faucet/ethereum/sepolia (about 0.05 ETH a day, inferred);
      - https://sepolia-faucet.pk910.de/ (proof of work; 0.05 to 2.5 ETH a session, inferred).

      Skip any faucet that needs real mainnet ETH in the wallet.
    - The Sepolia research puts 0.25 ETH as enough to launch and 1.2 ETH as about 1,600 deals (guessed).
    - Optional: an Etherscan API key at https://etherscan.io/myapikey, for source verification.

14. **Store the deploy secrets** (10 min).
    - [A] Create a second environment, `crow-deploy`. Use the build network list plus `api.cloudflare.com`, `ethereum-sepolia-rpc.publicnode.com`, `sepolia.gateway.tenderly.co` and `api.etherscan.io`. Add environment variables `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` and, if made, `ETHERSCAN_API_KEY`. Anyone who uses the environment can read them, and only you do.
    - [B] Run `sudo -u deploy sh -c 'umask 077; cat > /home/deploy/.config/crow/env'`, type the same variables, and press Ctrl-D.

    The Sepolia deployer stays on your laptop (T-206). A later deploy that moves off the laptop gets a new deployer key in the deploy environment, never a copy of the keystore.

### Later, with the work that needs them

15. **Cross-family review keys** (15 min), before T-045's or T-046's live test runs, and at T-050.
    - DeepSeek: https://platform.deepseek.com/api_keys. There is no spend limit, only a prepaid balance (documented) that every key in the account shares (inferred). Keep it small, for example USD 10, at https://platform.deepseek.com/top_up. For a cap separate from the judges', open a second DeepSeek account.
    - OpenAI, once T-040 pins a GPT model: create a project named `crow-review`. In its Limits, choose Edit spend limit, then Monthly spend limit, then Enforce a hard limit (https://platform.openai.com/settings/). Without the hard limit, it only alerts (documented).
    - Give a key to one session for one approved run, or to the GitHub Environment at T-050. Add each key to the sever list.

16. **Stripe test key, when the Phase 5 on-ramp task starts** (5 min). Create a sandbox from the account picker (Sandboxes) and copy its secret key from https://dashboard.stripe.com/apikeys. It must start with `sk_test_`. A restricted `rk_test_` key is refused by the startup guard (hard rule "No real money").

17. **Review the caps in one place** (10 min), before T-050:
    - the Anthropic `crow-agents` limit and notifications;
    - the DeepSeek balance;
    - the OpenAI hard limit;
    - Cloudflare budget alerts on Paid;
    - GitHub: Actions are free for this public repository; keep the spending limit for paid features at USD 0 under https://github.com/settings/billing;
    - the VM's fixed price.

## Part (b): the agents' steps

Every step is **agent** unless marked. Times are guessed.

1. **`scripts/dev-env/setup.sh`** (2 hours). It is idempotent, needs no secret and prints only tool versions. It:
   - checks Node 22.18 or later;
   - enables pnpm 12.16.1 through corepack;
   - runs `pnpm install --frozen-lockfile`;
   - installs Foundry at the version CI pins (`v1.0.0`) and initializes the `contracts/lib/` submodules;
   - installs gitleaks;
   - installs Java 21 only with `--formal`.

   It stops at the first failure with a non-zero exit, so a broken install never starts a half-ready session. A cloud session also fails when its setup script does not exit 0 (documented). The laptop-only workarounds (`TMPDIR` and the Foundry and pnpm stores under `reports/`) are not needed here, so it sets none.

2. **`scripts/dev-env/vm-users.sh`** [B] (2 hours). It runs once as root and holds no secret. It:
   - creates `agent`, `deploy` and `minter`;
   - creates `/home/minter/.config/crow/` with mode 700, so only `minter` can read it;
   - creates each user's `~/.config/crow/` and makes `agent`'s and `deploy`'s login shells load their `env` file;
   - copies `gh-app-token.mjs` to `/opt/crow/`, owned by root and not writable by others;
   - adds a sudoers rule letting `agent` and `deploy` run exactly `/usr/bin/node /opt/crow/gh-app-token.mjs git` or `… token` as `minter`, and nothing else. sudo's default `env_reset` keeps `NODE_OPTIONS` and similar variables out (inferred).

   Re-running it updates the copy; only someone with root can do that.

3. **`scripts/dev-env/gh-app-token.mjs`** [B] (2 hours). Run as `minter`, it mints an installation token narrowed to `holdback` and to the App's permissions, valid for one hour (documented lifetime). With `git` it answers git's credential-helper protocol; with `token` it prints the token for a `gh` wrapper. It refuses any other argument, never prints or copies the key, and writes nothing to disk. Tests use a throwaway key.

4. **`docs/dev-env.md`** (1 hour). It covers:
   - how to start a build and a deploy session on A and on B;
   - the credential table above;
   - how to watch a session (`ssh` and `tmux`);
   - the sever list;
   - A's limits (REST instead of `gh pr`, no auto-merge arming, no branch deletion).

   It also flags that T-036's `/merge-pr`, T-041's intake and T-048's claim release need REST and no-deletion paths on A.

5. **`config/keys-dev-env.template`** (30 min).
   - Split it into build and deploy sections, with every variable above.
   - Correct the console URL (platform.claude.com).
   - Say that a fine-grained token cannot write as a collaborator.
   - Set the commit identity on B to the App's bot: `crow-agents[bot]` and `<bot-id>+crow-agents[bot]@users.noreply.github.com`. The bot ID comes from `gh api /users/crow-agents%5Bbot%5D`. On A, it stays Rafa's noreply address.
   - Give `config/keys.template` a one-line pointer.

6. **Permission settings that avoid prompts** (1 hour).
   - On B, sessions run as `agent`, which is not root, with `claude --dangerously-skip-permissions`.
   - On A, sessions use Auto mode where offered, otherwise Accept edits. `.claude/settings.local.json` does not apply in cloud sessions (documented), so the allow list in `.claude/settings.json` keeps every command in `CLAUDE.md`'s verify list.
   - The deny rules (`.env*`, force pushes, `forge script`, `cast send`) stay everywhere, and they still bind in bypass mode (documented).
   - Laptop sessions keep the rules in `docs/operations.md`.

7. **`scripts/dev-env/smoke.mjs`, and a session probe** (3 hours). The script prints each check's name and result, never a value:
   - **Identity:** `gh api` reports `crow-agents[bot]` (B), or Rafa's account through the proxy on A, as a known limit.
   - **Reach:** an installation token lists only `holdback`; `gh api /repos/rafaeldavid/holdback` shows push access; the same read on another of Rafa's repositories shows none.
   - **Key custody (B):** `agent` cannot read `/home/minter/.config/crow/app.pem` and cannot write `/opt/crow/gh-app-token.mjs`; a minted token expires within one hour.
   - **No personal Claude login (B):** no `~/.claude/.credentials.json` for `agent` or `deploy` (inferred path of Claude Code's login store on Linux), and no Remote Control process.
   - **No personal files:** no private key under `~/.ssh`, no `~/.aws`, no `~/.config/gcloud`, no `~/.npmrc`, and no `.env` at the repository root in a build session. All checked by existence only.
   - **Environment variable names:** they match the session type's list exactly. Any other name ending in `_KEY`, `_TOKEN` or `_SECRET` fails.
   - **Deploy only:** Cloudflare's `GET /client/v4/user/tokens/verify` answers active.
   - **If set:** the Stripe key starts with `sk_test_`.

   A script never passes through Claude Code's permission layer, so the deny rules get a separate probe. In a live session, create `reports/scratch/.env.probe` holding no secret, ask the session to read it, and record that the read is refused.

8. **Prove nothing reaches Rafa's accounts** (human, 10 min). After the smoke test passes in both session types, Rafa checks:
   - https://github.com/settings/security-log, for token use he did not cause;
   - Anthropic usage, which should appear only under `crow-agents` (B);
   - Cloudflare's audit log, which should show only `crow-deploy` activity from the environment.

   He records the result in Evidence.

## Acceptance criteria

- [ ] Rafa's steps 1 to 10 are done, each ticked in Handoff with the date (human). Steps 11 to 14 follow before the first deploy from the environment.
- [ ] `pnpm vitest run tests/dev-env.test.ts` passes, with no network, covering:
  - the setup script's checks;
  - `vm-users.sh`'s modes and sudoers rule, on a fixture root;
  - the token minter on a throwaway key, including its refusal of other arguments;
  - the smoke test's parsing.
- [ ] `node scripts/dev-env/smoke.mjs` passes in a build session and in a deploy session, and its report is pasted in Evidence (measured). The deny-rule probe is recorded too.
- [ ] A build session runs `pnpm verify` end to end with no approval prompt (measured: the transcript shows none).
- [ ] Part (b) step 8 is recorded in Evidence (human).

## Out of scope

- The pipeline's own keys and settings at activation (T-050).
- The live demo's Worker secrets.
- Moving the Sepolia deployer off the laptop.
- Mainnet, of any kind.

## Evidence

## Decisions

- Recommend B because only a separate identity lets tier 3 review and attribution work. A stays documented as the quick start.
- Workflows: No access for the agents. This closes the forged-status path, and workflow changes become Rafa's to push.
- The App key lives with `minter`, and agents get one-hour tokens: a leaked token expires, and the key never reaches an agent.

## Handoff
