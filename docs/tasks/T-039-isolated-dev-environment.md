# T-039: Isolated development environment for the agents

- **Lane:** infra
- **Phase:** 10
- **Depends on:** nothing in the repository. Rafa can start part (a) before the rest of Phase 10, because the environment also ends the approval prompts on his laptop. Part (b) lands in two PRs, the one exception to "one task, one PR" in this phase. Steps 1 to 3 hold no secret, so agents build them first, anywhere; Rafa's VM setup runs them. Steps 4 to 7 follow his go-ahead.
- **Paths this task may touch:** `scripts/dev-env/setup.sh` (new), `scripts/dev-env/vm-users.sh` (new), `scripts/dev-env/gh-app-token.mjs` (new), `scripts/dev-env/start-session.sh` (new: the launcher; it resets the slot's home), `scripts/dev-env/deploy.sh` (new: the deploy wrapper), `scripts/dev-env/gh-wrapper.sh` (new), `scripts/dev-env/managed-settings.json` and `scripts/dev-env/managed-CLAUDE.md` (new: the sources `vm-users.sh` installs under `/etc/claude-code/`), `scripts/dev-env/home-templates/` (new: one folder per role), `scripts/dev-env/smoke.mjs` (new), `tests/dev-env.test.ts` (new), `docs/dev-env.md` (new), `config/keys-dev-env.template`, `config/keys.template` (a pointer only), `.claude/settings.json` (the allow list only), `docs/operations.md` (Secrets; Working without permission prompts), `docs/tasks/T-039-isolated-dev-environment.md`
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

- `agent-ops/pipeline.md` (Concurrency), and threats P4, P6 and P9 in `agent-ops/gates.md` (PR 112).
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
3. no agent can read a GitHub credential that outlives one hour.

Two keys are exceptions:
- the `crow-agents` Anthropic key, which lasts 30 days and can be read where exe.dev cannot inject it; its workspace's monthly limit caps it;
- the 90-day `crow-deploy` Cloudflare token, which only deploy sessions hold, on Rafa's go-ahead.

A is a sound quick start for build sessions before activation, and it ends there. From T-050 step 2, every PR needs `crow-review`'s approval, which only B can give. On A, sessions also act as Rafa, so the branch rulesets and the author and approver checks do not apply to them. A third option, Claude Code's self-hosted environments, is for Team and Enterprise plans only (documented).

## Two kinds of session

The design gives build agents no model, Cloudflare or chain keys (P4). So the environment has two secret sets.

- **Build sessions**, used for every task, read and write this repository and hold nothing else. On B, they also hold the capped key Claude Code itself runs on.
- **Deploy sessions** add the Cloudflare token. They run only on Rafa's go-ahead (`docs/operations.md`).

On A, the two sets are two environments. On B, each role gets its own Unix user, so one session's code cannot leave instructions or hooks for the next. The users:
- `builder`: implementers and the fixture-author;
- `reviewer`;
- `verifier`;
- `tick`: the tick and the lander;
- `deploy`;
- `minter`, which holds the two GitHub App keys and hands each role a one-hour token narrowed to what that role may do;
- one runner per reviewer and verifier slot user (`runner-reviewer-1`, `runner-verifier-1` and so on). These hold nothing and run code from a PR.
- `cfdeploy`, which holds the Cloudflare token. Only the deploy wrapper runs as it.

The builder, reviewer and verifier roles get one user per slot (`builder-1` and so on, part (b) step 2), so parallel lanes never share a user.

## Where each credential lives

| Credential | Build | Deploy | GitHub (Actions or Environment) | Cloudflare Worker secret | Rafa's laptop only |
| --- | --- | --- | --- | --- | --- |
| GitHub App private keys, `crow-agents` and `crow-review` (B) | — (one-hour tokens through `minter`, narrowed per role; only `reviewer` gets `crow-review`) | — (the same) | — | — | backup in his password manager |
| Rafa's GitHub login, 2FA and recovery codes | — | — | — | — | yes |
| Anthropic `crow-agents` key, capped (Claude Code on B; live triager runs) | yes (B) | yes (B) | — | — | — |
| Cloudflare API token `crow-deploy` | — | yes on A; on B only through `/opt/crow/deploy`, which runs as `cfdeploy` | — | — | — |
| Cloudflare login (account owner) | — | — | — | — | yes |
| Live judges' keys (Anthropic, DeepSeek; moved to the capped `crow-judges` workspace by T-051 step 2) | — | — | — | yes, today | yes, in `.env` |
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

1. **Confirm the Cloudflare plan, then choose A or B** (10 min) [both].
   1. In the Cloudflare dashboard, under Workers & Pages, then Plans, confirm the account is on Workers Paid. Rafa said on 2026-11-03 that it should be, since 2026-11-02, so this checklist treats it as Paid. If it shows Free, write that in Handoff. It is the same check as T-051 step 5.1, so do it once.
   2. Read the table above and write the choice of A or B in Handoff.

2. **Harden your own GitHub account** (15 min) [both].
   - Two-factor authentication: https://github.com/settings/security, then Enable two-factor authentication. Keep the recovery codes in your password manager.
   - Fine-grained tokens: https://github.com/settings/personal-access-tokens. Delete unused ones. Set the rest to expire.
   - Classic tokens: https://github.com/settings/tokens. Delete unused ones.
   - Authorized OAuth apps: https://github.com/settings/applications. Revoke what you do not recognise.
   - Installed GitHub Apps: https://github.com/settings/installations. Open Claude, choose Configure, and set Repository access to Only select repositories: `holdback`.
   - Security log: https://github.com/settings/security-log. Look for `personal_access_token` or `oauth_authorization` events you did not cause.
   - On A, do not run `/web-setup`. It sends your personal `gh` token to the cloud.

3. **Create the agents' two GitHub Apps** (30 min) [B]. There are two because the reviewer's approval is the review GitHub will require before any merge (T-050 step 2). So the reviewer needs an identity that no builder can act as.

   For each app, go to https://github.com/settings/apps/new and fill in:
   - Homepage URL: https://escrow.stream.
   - Webhook: clear Active.
   - Where can this GitHub App be installed: Only on this account.

   Then create it. Note the App ID. Under Private keys, choose Generate a private key, and store the `.pem` in your password manager. Choose Install App, then Only select repositories: `holdback`, and note the installation ID (the number at the end of the installation's URL).

   1. **`crow-agents`**, for builders, the verifier and the tick. Its repository permissions:
      - Contents: Read and write.
      - Pull requests: Read and write.
      - Actions: Read and write. The app holds it so that `minter` can rerun a listed flake itself (T-049). The agents' own tokens are narrowed to Actions read, because write would also let them dispatch, disable or rerun any workflow (documented).
      - Issues: Read-only. Agents cannot add the `intake` label, so only you decide which issue becomes a ticket.
      - Variables: Read-only, so the tick can read `AGENT_OPS` and never change it.
      - Workflows: **No access.** With write access, a branch push could add an `on: push` workflow that posts `check`, `gitleaks` or `xreview` as passing and reads repository secrets.
      - Commit statuses, Secrets, Environments and Administration: No access.
   2. **`crow-review`**, for the reviewer only. Its repository permissions:
      - Contents: Read and write. GitHub counts a required approval only from an account with write access (documented). The `t-branches` and `agent-branches` rulesets in step 4 keep this app from pushing to any branch.
      - Pull requests: Read and write, to submit reviews.
      - Everything else: No access.

   Fallback, if you prefer person-like accounts: a machine user (GitHub's Terms allow one free machine account besides your own) added as a collaborator with Write on `holdback`. It needs a classic token with the `public_repo` scope and without `workflow`. A fine-grained token cannot write to a personal account's repository as a collaborator (documented). One machine account cannot also be a separate reviewer, so the fallback leaves review unenforced.

4. **Check the repository's Actions and ruleset settings** (10 min).
   - [both] At https://github.com/rafaeldavid/holdback/settings/actions, under Workflow permissions, choose "Read repository contents and packages permissions", and clear "Allow GitHub Actions to create and approve pull requests".
   - [both] At https://github.com/rafaeldavid/holdback/settings/rules, open `main` and confirm its Bypass list is empty (measured empty on 2026-11-02). Your own bypass, for tier 3 PRs, goes in a separate ruleset at T-050, so `check` and `gitleaks` stay required for everyone.
   - [B] Create a branch ruleset, `agent-branches`, so the agents can create and push only their `t-*` claim branches. Without it, `crow-agents` could push to one of your own branches while your PR on it waits to merge.
     - Enforcement: Active.
     - Target branches: Include all branches; Exclude by pattern `main` and `t-*`.
     - Rules: Restrict creations, Restrict updates, Restrict deletions.
     - Bypass list: Repository admin, Always allow, so your own branches keep working. Add Dependabot too: security updates are on (measured), and they need their own `dependabot/*` branches. If the bypass list does not offer Dependabot (inferred that it does), exclude `dependabot/**` instead, and accept that both Apps could then push there.

     On A, sessions push as you and bypass this ruleset, so it protects nothing there.
   - [B] Create a branch ruleset, `t-branches`, so that only `crow-agents` writes claim branches, and `crow-review` cannot.
     - Target branches: Include by pattern `t-*`.
     - Rules: Restrict creations, Restrict updates, Restrict deletions.
     - Bypass list: `crow-agents` (the app) and Repository admin, Always allow.
   - [B] Create a tag ruleset, `tags`, because both Apps' Contents write also covers tags. From T-050 on, deploys run from a tag you create, so no agent may move one.
     - Target tags: Include all tags.
     - Rules: Restrict creations, Restrict updates, Restrict deletions.
     - Bypass list: Repository admin, Always allow.

5. **Create the capped Anthropic workspace and key** (10 min) [B; A only for a live triager run]. Go to https://platform.claude.com/settings/workspaces (console.anthropic.com redirects there).
   1. Choose Create workspace and name it `crow-agents`.
   2. Under Spend limits, choose Change limit for the Monthly limit. USD 100 is a guess. The Default workspace cannot hold a limit (documented).
   3. Choose Add notification at 50% and at 80%.
   4. At https://platform.claude.com/settings/keys, choose Create key in `crow-agents`, with a 30-day or custom expiry.

   At the limit, the API refuses requests and sessions stop: that is the cap working. Keep the organization's monthly limit (T-051 step 1) at or above the sum of the workspace limits, `crow-judges` and `crow-agents`, or the organization limit binds first.

6. **Set up the VM** (45 min) [B]. Part (b) steps 1 to 3 must be merged first.
   1. Create a VM with at least 4 vCPU and 8 GB, named `crow`. On exe.dev: `ssh exe.dev` to register, then create it in the web UI or with `ssh exe.dev new`, choosing the name and size as https://exe.dev/docs describes.
   2. On the VM, run `git clone https://github.com/rafaeldavid/holdback.git`, then `sudo bash holdback/scripts/dev-env/vm-users.sh`. It holds no secret. It creates:
      - the slot and role users, `minter`, `cfdeploy` and the runners, with their folders;
      - the intake folder `/srv/crow/intake/`;
      - the root-owned launcher, `/opt/crow/start-session`;
      - the root-owned Claude Code managed settings;
      - the minter rules;
      - the root-owned copies of the scripts.
   3. Send each App key straight from your Mac, so it never sits in a clipboard or a terminal's scrollback. Run `ssh <vm> 'sudo -u minter sh -c "umask 077; cat > /home/minter/.config/crow/crow-agents.pem"' < ~/Downloads/<the-agents-key>.pem`, and the same command for `crow-review.pem`. This assumes the VM's default user has sudo without a password (inferred for exe.dev). Then delete the downloaded files.
   4. Run `sudo -u minter sh -c 'umask 077; cat > /home/minter/.config/crow/app.env'`, and type each app's App ID and installation ID (`AGENTS_APP_ID=`, `AGENTS_INSTALLATION_ID=`, `REVIEW_APP_ID=`, `REVIEW_INSTALLATION_ID=`), one per line. Press Ctrl-D. These IDs are not secret.
   5. Give Claude Code its key. If exe.dev's Integrations can inject it at the network edge (https://exe.dev/docs/integrations; whether Claude Code works that way is inferred), use that. Otherwise, write a one-line file `ANTHROPIC_API_KEY=<the crow-agents key>` on your Mac and send it the same way to `/etc/crow/anthropic.env`: `ssh <vm> 'sudo sh -c "umask 027; cat > /etc/crow/anthropic.env; chgrp crow-claude /etc/crow/anthropic.env"' < <that file>`. Then delete the file. The role users that run Claude Code can read this key; the workspace limit bounds the loss. `runner` cannot read it.
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

   The coordinator session on your laptop runs in bypass mode, holds your admin `gh` login and wrangler's login, and accepts messages from other sessions (`.claude/settings.local.json`, measured). So anything that session does on GitHub carries your name. It can approve a PR as you, or make a commit through the API that GitHub shows as yours. The tier 3 review, the raised-tier rule and the approval lines in task files all count either as your decision (inferred). A deny rule is not a security boundary (Claude Code docs). Make these two changes before build sessions start, unless you decide otherwise and write why in Handoff:
   - give the coordinator a `GH_TOKEN` of its own: a fine-grained token on your account, limited to `holdback`, with Pull requests read-only and no Administration, Secrets or Variables permission. Keep your admin login for your own shell, where approvals happen.
   - turn off other sessions' messages to it.

   Record your choice in Handoff.

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

12. **Cost guards on the live accounts** (0 min here) [both]. The account is on Workers Paid (step 1), which has no spend cap. Two tasks already guard it, and this checklist does not repeat them:
    - T-051 step 5 sets the Cloudflare budget alerts and usage notifications, and its other steps set the account-wide guards (Anthropic's organization limit, GitHub's $0 budgets, DeepSeek's balance).
    - T-054 sets a CPU limit per Worker, the only brake on a runaway Worker's bill, from measured CPU time.

    Do T-051 before the first deploy from the environment.

13. **Fund the Sepolia accounts** (10 min, plus days of faucet waits) [both].
    - Send faucet ETH to the relayer's funding lane, `0x601137a8DE7E195E1426f57C053aFa49B20Ef555` (`docs/operations.md`), and to the T-206 deployer address. Faucets:
      - https://cloud.google.com/application/web3/faucet/ethereum/sepolia (about 0.05 ETH a day, inferred);
      - https://sepolia-faucet.pk910.de/ (proof of work; 0.05 to 2.5 ETH a session, inferred).

      Skip any faucet that needs real mainnet ETH in the wallet.
    - The Sepolia research puts 0.25 ETH as enough to launch and 1.2 ETH as about 1,600 deals (guessed).
    - Optional: an Etherscan API key at https://etherscan.io/myapikey, for source verification.

14. **Store the deploy secrets** (10 min).
    - [A] Create a second environment, `crow-deploy`. Use the build network list plus `api.cloudflare.com`, `ethereum-sepolia-rpc.publicnode.com`, `sepolia.gateway.tenderly.co` and `api.etherscan.io`. Add environment variables `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` and, if made, `ETHERSCAN_API_KEY`. Anyone who uses the environment can read them, and only you do.
    - [B] Write the same variables to a file on your Mac and send it to the `cfdeploy` user, not to `deploy`: `ssh <vm> 'sudo -u cfdeploy sh -c "umask 077; cat > /home/cfdeploy/.config/crow/env"' < <that file>`. Then delete the file. A deploy session then reaches the token only through the wrapper, so it cannot run wrangler around the tag check.

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
    - the account-wide guards from T-051 (Cloudflare budget alerts, GitHub's $0 budgets, Anthropic's organization limit), and T-054's per-Worker CPU limits;
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

2. **`scripts/dev-env/vm-users.sh`** [B] (4 hours). It runs once as root and holds no secret. It:
   - creates one user per session slot, so parallel lanes never share a user or kill each other's work:
     - `builder-1` to `builder-K`, `reviewer-1` to `reviewer-K` and `verifier-1` to `verifier-K`, where K is the largest `wip.implementers` planned (five, `after_T-034` in `ops.yaml`);
     - one `tick` and one `deploy`.

     "Role user" below means any of these.
   - creates `minter`, and `cfdeploy`, whose home holds the Cloudflare token with mode 700.
   - creates one runner for each reviewer and verifier slot user: `runner-reviewer-1` to `runner-reviewer-K` and `runner-verifier-1` to `runner-verifier-K`. They have no key, no group and no sudo rule of their own, and run code from a PR. A reviewer and a verifier never share a runner, even in the same slot.
     - **Its own clone, per session:** each runner clones the public repository into its own folder, `/srv/crow/runner/<runner>/`, and checks out the PR's head there itself, with no token. No role user can read that tree, and no Claude Code session ever opens it as a project, so its `.claude/` and `CLAUDE.md` never load.
     - **How the reviewer reads results:** only through `runner`'s own permissions. It runs `sudo -u <its runner> cat <file>` into a file it owns, and reads the command's output and exit status. No root process copies anything out of a runner's tree, because a root copy could follow a symlink that PR code planted there and copy an App key into reach.
     - **Nothing survives a session:** before each session, the launcher below kills the processes of the runner that belongs to the session's user, and wipes that runner's folder. A daemon left by one PR's tests cannot tamper with the next, and every other session is untouched.
     - **Its own temporary folder:** each runner gets a `TMPDIR` under its own folder, and no local socket of the tick's is reachable from it.
   - adds a sudoers rule that lets each `reviewer-<n>` run any command as `runner-reviewer-<n>`, and each `verifier-<n>` as `runner-verifier-<n>`. That is safe because a runner holds nothing.
   - makes each user's home mode 700. The users that run Claude Code join the group `crow-claude`, which can read `/etc/crow/anthropic.env`.
   - writes Claude Code's managed settings, `/etc/claude-code/managed-settings.json` and `/etc/claude-code/CLAUDE.md`, owned by root (documented paths). Managed settings outrank the same keys elsewhere, but alone they would still let hooks and MCP servers load from project and user files. So the file also sets `allowManagedHooksOnly` and `allowManagedMcpServersOnly` (documented). Without them, a hook in a PR branch's `.claude/settings.json` would run as whichever user opened that checkout.
     - It does not set `allowManagedPermissionRulesOnly`. That flag would make the managed file the only source of permission rules, so the role templates' deny rules would never load. In bypass mode allow rules have no effect anyway (documented), so the flag would remove protection and add none.
   - holds, in the managed settings, the deny rules and no hooks before activation. T-050 step 4 adds the shell-guard and budget-stop hooks.
   - writes each role's home template, `scripts/dev-env/home-templates/<role>/`, which holds that role's own deny rules.
   - installs `/opt/crow/start-session`, a root-owned launcher. It is the only way one user starts a session as another. The sudoers file lists it for `tick` once per role. The launcher:
     - takes exactly two arguments: a role, which must be `builder`, `reviewer` or `verifier`, and a task ID matching `T-[0-9]{3}`. It refuses anything else. Above all it refuses `deploy`, `tick` and `minter`: deploy sessions are started by Rafa over `ssh`, never by the tick.
     - picks a free slot for the role itself. It kills that slot user's processes and its runner's, and wipes that runner's folder.
     - rebuilds the slot user's home from its role's root-owned template in a temporary folder, then moves it into place. It never runs `rm -rf` on a path built from input, and uses `set -euo pipefail` with no shell interpolation.
     - fetches `main` into a root-owned clone itself, never through `tick`. It builds the brief with `brief.mjs` from that clone and the task file on `main`, then starts `claude -p` as the slot user.

     `tick` never passes a prompt, so nobody who holds the tick can tell a reviewer session what to approve. The tick is a plain process with no model (T-048).
   - installs `/opt/crow/deploy <tag> <sha>`, a root-owned wrapper whose source, `scripts/dev-env/deploy.sh`, is tier 3. The `deploy` user may run it, through sudo, as `cfdeploy`, the only user that can read the Cloudflare token. It does no deploy any other way: the token is out of its reach, so a deploy session cannot run wrangler around the check. The wrapper:
     - checks that `git rev-parse <tag>^{commit}` equals the SHA in Rafa's go-ahead;
     - clones that commit fresh into a new folder and runs `pnpm install --frozen-lockfile` there;
     - deploys from that clone with `pnpm demo-cloud:deploy`, never from a working tree a session controls.

     It also offers the read-only commands the runbook uses, such as `tail <worker>`. The check sits outside the tier 2 deploy code it protects (T-050 step 9).
   - creates `/home/minter/.config/crow/` with mode 700, so only `minter` can read the two App keys;
   - creates `/srv/crow/intake/`, owned by `deploy`, with the group `crow-intake` that the builder slot users and `tick` belong to, mode 750 for the folder and 640 for its files. The deploy side writes the feedback export and the signal records there (T-041, T-042), and the build side reads them.
   - copies `gh-app-token.mjs` to `/opt/crow/`, owned by root and writable by no one else;
   - adds sudoers rules that let each role run exactly `/usr/bin/node /opt/crow/gh-app-token.mjs <role>`, as `minter`, with one of these argument lists and nothing else: `git get`, `git store`, `git erase`, `token` or `scopes`. git calls a credential helper with an extra verb, and a sudoers rule that lists arguments must match them exactly. `tick` may also run `rerun <run-id>`, and the script accepts digits only there. sudo's default `env_reset` keeps `NODE_OPTIONS` and similar variables out (inferred).
   - installs `/opt/crow/gh`, a root-owned wrapper that gets the role's token and runs `gh` with `GH_TOKEN` set in the child's environment only, so normal use never prints a token into a session.

   Re-running it updates the copies; only someone with root can do that.

3. **`scripts/dev-env/gh-app-token.mjs`** [B] (3 hours). It imports Node built-ins only. Run as `minter`, it mints a one-hour installation token (documented lifetime) narrowed to `holdback` and to the role's permissions:

   | Role | App | Permissions |
   | --- | --- | --- |
   | `builder` | `crow-agents` | contents and pull requests write; actions, issues and variables read |
   | `verifier`, `deploy` | `crow-agents` | contents and pull requests read |
   | `tick` | `crow-agents` | contents and pull requests write; actions, issues and variables read |
   | `reviewer` | `crow-review` | contents read; pull requests write |

   Its commands:
   - `git get` answers git's credential-helper protocol, and `git store` and `git erase` do nothing;
   - `token` prints the token for `/opt/crow/gh`;
   - `scopes` prints the role's permissions without a token, for the smoke test;
   - `rerun <run-id>` (`tick` only) reruns a run's failed jobs with an Actions-write token it never hands out, only if every failure is a listed, unexpired flake rerun once at most (T-049). It reads the Known flakes list from `docs/testing.md` on `main` through the API, never from a checkout a role user can edit.

   It refuses any other argument, never prints or copies a key, and writes nothing to disk. A session that runs the git helper by hand can still read its own one-hour, role-narrowed token: the wrapper keeps tokens out of normal output, but it is not a boundary. Tests use throwaway keys.

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
   - On B, each session runs as its role's user, which is not root, with `claude --dangerously-skip-permissions`.
   - Reviewer and verifier sessions start in a trusted checkout of `main`, with the PR's diff given as data, so the PR's own `CLAUDE.md` and `.claude/` never load as instructions or settings.
   - Code from a PR that they run, such as `pnpm verify`, runs as the session user's own runner, in that runner's clone under `/srv/crow/runner/` (`sudo -u runner-reviewer-<n>`, for example). A runner holds no token and no key. Code under review therefore cannot mint the reviewer's token and approve itself, and cannot rewrite the tree the reviewer reads.
   - On A, sessions use Auto mode where offered, otherwise Accept edits. `.claude/settings.local.json` does not apply in cloud sessions (documented), so the allow list in `.claude/settings.json` keeps every command in `CLAUDE.md`'s verify list.
   - The deny rules (`.env*`, force pushes, `forge script`, `cast send`) stay everywhere, and they still bind in bypass mode (documented).
   - Laptop sessions keep the rules in `docs/operations.md`.

7. **`scripts/dev-env/smoke.mjs`, and a session probe** (3 hours). The script prints each check's name and result, never a value:
   - **Identity:** `gh api` reports `crow-agents[bot]` (B), or Rafa's account through the proxy on A, as a known limit.
   - **Reach:** an installation token lists only `holdback`; `gh api /repos/rafaeldavid/holdback` shows push access for `builder`; the same read on another of Rafa's repositories shows none.
   - **Scopes (B):** `scopes` for each role matches the table in step 3. Only `reviewer` gets `crow-review`.
   - **Key custody (B):**
     - no role user and no runner can read a `.pem` under `/home/minter/.config/crow/`;
     - none can write `/opt/crow/`;
     - `/usr/bin/node` is owned by root and is not a symlink into a writable path;
     - a minted token expires within one hour;
     - no runner has a sudo rule or can read `/etc/crow/anthropic.env`;
     - no role can read another role's home;
     - `/etc/claude-code/` is owned by root, and its managed settings set `allowManagedHooksOnly` and `allowManagedMcpServersOnly`;
    - a session opened in a checkout whose `.claude/settings.json` adds a hook does not run that hook;
    - `reviewer-1` can run a command as `runner-reviewer-1`, and as no other runner. No runner can read any role's home, and no role user can read `/srv/crow/runner/`;
    - a symlink planted in a runner's clone, pointing at an App key, is not followed when the reviewer reads results;
    - `tick` can run nothing as another user except `/opt/crow/start-session <role> <task-id>`. The launcher refuses `deploy`, `tick`, `minter`, a bad task ID and an extra argument;
    - `deploy` cannot read the Cloudflare token. It can run `/opt/crow/deploy` as `cfdeploy`, and the wrapper refuses a tag whose commit differs from the given SHA;
    - starting a session in one slot leaves another slot's runner processes running, and no runner process of its own slot survives;
    - an approval by `crow-review` on a test PR counts toward the required review, which shows that the token's narrowing to Contents read does not cancel the App's write access (inferred until measured).
   - **No personal Claude login (B):** no `~/.claude/.credentials.json` for any role user (inferred path of Claude Code's login store on Linux), and no Remote Control process.
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
  - `vm-users.sh`'s users, modes, managed settings, intake folder and sudoers rules, on a fixture root, with `visudo -c` accepting the rules and git's `get` call matching them;
  - the launcher, fed hostile arguments (`../etc`, names with spaces, an extra argument, a symlinked home, the roles `deploy`, `tick` and `minter`), refusing each one;
  - the deploy wrapper, refusing a tag that points elsewhere;
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
- The App keys live with `minter`, and agents get one-hour tokens narrowed to their role. A leaked token expires, and no key reaches an agent.
- A second App, `crow-review`, used only by the `reviewer` user, makes the reviewer's approval something GitHub can require (T-050). PR code runs as a per-slot runner, which has no token, so code under review cannot approve itself. Source: the 2026-11-03 security pass on PR 131.
- One Unix user per role, homes reset from a template, and root-owned managed settings: code that one session runs cannot leave instructions or hooks for the next.

## Handoff
