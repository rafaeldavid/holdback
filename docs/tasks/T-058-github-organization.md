# T-058: Move the repositories into a GitHub organization

- **Lane:** infra (with one api-lane file: the operator's `API_REFERENCE` link)
- **Phase:** 9
- **Depends on:** nothing in the repository. It starts after a working mainnet prototype (Rafa, 2026-11-03: "lets add this to the roadmap for later, once we have working mainnet prototype"). Mainnet itself needs an audit and Rafa's written approval (`docs/operations.md`, Gates).
- **Paths this task may touch:**
  - before the transfer: `.github/workflows/ci.yml` (the `gitleaks` job only);
  - links, after it: `README.md`, `CONTRIBUTING.md`, `site/build.mjs`, `site/check.mjs`, `site/llms.txt` and the generated `site/index.html`, `spec/openapi/paths.json` and the generated `spec/openapi.json`, `apps/operator/src/openapi/index.ts` (`API_REFERENCE` only), `tests/contract/openapi.contract.test.ts` (the asserted URL only), `tools/design-map/template.html`, `agent-ops/flow.html`, living documents in `docs/`;
  - `config/keys-dev-env.template` (the token's resource owner), `.github/CODEOWNERS`, `docs/operations.md` (where the repositories live), `docs/tasks/T-058-github-organization.md`.
  - Left as written: `prompts/`, `docs/log/`, `docs/reviews/`, task Evidence, and the source comment in `examples/try.ts` (changing it would change the pinned sha256 of `site/try.mjs` for no gain).
- **Human gate:** **yes.** Creating the organization, its settings, the DNS record, transferring repositories, granting access and redeploying are all outside the repository. Rafa does the organization steps himself; agents run the transfer and access steps only on his go-ahead, given in chat and recorded in Handoff with the date.
- **Status:** todo
- **Agent/session:** —

## Intent

Move `rafaeldavid/holdback` and the founders' private repository into a GitHub organization that Crow owns, with least-privilege defaults, so contributors can get roles narrower than write, and so the company can own the code at incorporation.

- Inputs: the two repositories, Rafa's account, the `escrow.stream` DNS zone on Cloudflare.
- Outputs: an organization with 2FA required and no default access; both repositories transferred with their protections and security settings intact and CI still passing; teams with the right roles; links, tokens and remotes updated.
- Non-goals: incorporation, moving the organization to the company (Rafa's step at incorporation), a paid GitHub plan, anything about the Cloudflare account.

## Context

- **When.** Rafa set the trigger: after a working mainnet prototype. Until then, outside contributors work from a fork under `CONTRIBUTING.md` (PR 151). The design map shows Phase 9 open until this task is done, as T-309 keeps Phase 3 open.
- **Why an organization.** On a personal account, a collaborator can only get write: GitHub refused the triage role on `holdback` (measured by the coordinating session, 2026-11-03). Organization repositories offer triage, "for contributors who need to proactively manage issues … without write access" (documented, GitHub's repository roles page, read 2026-11-03).
- **Names in this public repository.** The private repository and the outside contributor are named here by role only. Rafa names them in chat; Handoff and Evidence say "the private repository" and "the contributor named on <date>", never a repository name or a login.
- **What a transfer keeps** (documented, GitHub's "Transferring a repository", read 2026-11-03): issues, pull requests, wiki, stars and watchers; webhooks, secrets and deploy keys; commit history. Web links and git remotes redirect to the new location. Creating a repository or fork at the old location deletes the redirects permanently. The page does not say whether repository rulesets, security settings, GitHub App installations, `raw.githubusercontent.com` URLs or REST API paths move or redirect, so this task checks each one after the move.
- **CI would stop merging.** The required `gitleaks` check runs `gitleaks/gitleaks-action@v2` with only `GITHUB_TOKEN` (`.github/workflows/ci.yml`). Its README says `GITLEAKS_LICENSE` is "required for organizations, not required for user accounts" (documented, read 2026-11-03), and a license means a sign-up with name, email and company. So the job would fail after the transfer and no PR could merge. Agent step 1 replaces the action before the move.
- **Plan limits.** A private repository transferred to a GitHub Free organization loses protected branches (documented). Protected branches, code owners and required reviewers in private repositories need GitHub Team (documented, GitHub's plans page). The private repository has none of them today: on Rafa's personal Free plan the API answers "Upgrade to GitHub Pro" for its rulesets and branch protection (measured, 2026-11-03), so nothing is lost. `holdback` is public, and its `main` ruleset is active on the Free plan today (measured).
- **Today's protections on `holdback`** (measured, 2026-11-03): the `main` ruleset (PR required; `check` and `gitleaks` must pass; no force push or deletion; no bypass), secret scanning with push protection, Dependabot security updates, CodeQL default setup. No Actions secrets, variables, webhooks, deploy keys or environments.
- **Links:** 52 references to `github.com/rafaeldavid/holdback` in tracked files (measured, 2026-11-03), 17 of them in each OpenAPI file. The live nodes serve two of them: `API_REFERENCE` at `/llms.txt`, and the OpenAPI links at `GET /v1/openapi.json`. So updating them needs a Workers redeploy as well as a site redeploy.
- **Credentials scoped to Rafa's account.** A fine-grained token covers one resource owner, so a `GH_TOKEN` made with owner `rafaeldavid` (`config/keys-dev-env.template`) loses access to the moved repository (inferred). T-039's `crow-agents` GitHub App, if it exists by then, is installable "only on this account" and must move to the organization. T-052's `crow-costs-read` token reads Rafa's own billing (a user permission) and is not affected (inferred).

## Rafa's steps

Every step is **human**. About 1 hour, plus up to 72 hours for DNS (guessed; the 72 hours is GitHub's documented upper bound).

1. **Create the organization** (10 min) on the free plan, from https://github.com/organizations/plan.
   - Name: neutral and close to the domain, for example `escrowstream` (no GitHub account used that name on 2026-11-03, measured). It can be renamed later, which matters while the trademark question on "Crow" is open.
   - Contact email: a team address, not a personal one.
   - Owner: "My personal account" for now; switch it to the company at incorporation.
2. **Settings** (20 min), under the organization's Settings:
   - Authentication security: "Require two-factor authentication for everyone in your organization" (documented). Members without 2FA lose access until they turn it on; outside collaborators without it are removed (documented). Your own 2FA must already be on.
   - Member privileges, Base permissions: no permission, so access comes only from teams (documented path).
   - Member privileges, repository creation: members cannot create public or private repositories; only owners create them (inferred path; GitHub's page on restricting repository creation was not read).
   - Personal access tokens: allow fine-grained tokens with your approval, and plan to reissue any token whose owner is `rafaeldavid` with the organization as owner.
   - Third-party application access: check whether the GitHub CLI and Claude need approval to act on the organization's repositories, and approve them if so (inferred: a policy may restrict OAuth apps on new organizations).
   - Verified and approved domains: add `escrow.stream`, then add the TXT record GitHub shows in Cloudflare's DNS for the zone. GitHub's page does not say whether Free organizations get this; if the option is missing, note it in Handoff and skip it.
3. **Apps** (5 min). Install the Claude GitHub App on the organization for the two repositories, with the same selection as today (inferred: an installation belongs to one account). If `crow-agents` exists (T-039), transfer the App to the organization and install it there.
4. **The private repository's notes** (5 min). Before an outside contributor gets write on the private repository, confirm that the notes kept there under vendor-provided access (PR 148) may be shared with them.
5. **Go-ahead** (2 min), in chat: the organization's name, the private repository's name, the outside contributor's GitHub login, and that agents may run agent steps 2 to 5. The agent records the go-ahead and its date in Handoff, without the names.
6. **After the agents' steps** (20 min):
   - check the organization's audit log for anything you did not expect, and confirm the contributor can triage on `holdback`;
   - reissue any fine-grained token owned by `rafaeldavid` with the organization as owner;
   - update the remote in the T-052 cost clone, if it exists (`git remote set-url origin https://github.com/<organization>/holdback.git`), since no agent works there;
   - redeploy the operators (`pnpm demo-cloud:deploy`) and the site (`docs/operations.md`, Deploy) once the links PR merges;
   - review the links PR yourself: it touches `/spec/`, which CODEOWNERS gives to you, although only description links change.

## Agent steps

1. **Before the transfer, in its own PR (infra), with no go-ahead needed** (1 hour). Replace `gitleaks/gitleaks-action@v2` with the gitleaks CLI at a pinned release, checked against its published sha256, in a job still named `gitleaks`, so the required check's name and its scan of the full history stay the same. Coordinate with PR 109 if it is still open, since it pins the CI actions. CI must pass on that PR.
2. **Record what exists** (15 min), in `reports/scratch/t-058-before.json`: the `holdback` rulesets with their rules (`gh api repos/rafaeldavid/holdback/rulesets` and each ruleset by ID), `security_and_analysis`, Actions secret and variable names (never values), webhooks and deploy keys (IDs and URLs only), environments. The same for the private repository, where they exist.
3. **Transfer** (10 min). `gh api -X POST repos/rafaeldavid/holdback/transfer -f new_owner=<organization>`, then the same for the private repository. Never create a repository with either name under `rafaeldavid` afterwards: it would delete the redirects.
4. **Check what moved** (30 min), against the record from step 2, and record each result in Evidence:
   - the `main` ruleset active with the same rules, recreated from the record if missing;
   - secret scanning, push protection, Dependabot security updates and CodeQL default setup on;
   - the secret and variable names, webhooks and deploy keys present;
   - redirects: `curl -sI` on `https://github.com/rafaeldavid/holdback`, on `https://raw.githubusercontent.com/rafaeldavid/holdback/main/docs/api.md` (the live nodes' `API_REFERENCE` until the redeploy), and on `https://api.github.com/repos/rafaeldavid/holdback`;
   - a CI run on a trivial PR passes every required check, `gitleaks` included.
5. **Teams and roles** (10 min). Create `maintainers` (Rafa; admin on both repositories) and `contributors`. Give the contributor named in the go-ahead triage on `holdback` and write on the private repository, through `contributors` if team roles allow triage, otherwise directly. They need 2FA on before joining.
6. **Links** (1 hour), in a PR after the transfer: replace `github.com/rafaeldavid/holdback` and `raw.githubusercontent.com/rafaeldavid/holdback` with the organization's paths in the files listed under Paths, the contract test's asserted URL included. Regenerate `spec/openapi.json` (`pnpm openapi`) rather than editing it; the change is to links in descriptions, not the contract. Rebuild and check the site (`node site/build.mjs`, `node site/check.mjs`). Point `config/keys-dev-env.template` at the organization as the token's resource owner. Consider `@<organization>/maintainers` in `.github/CODEOWNERS`. Tell Rafa the operators and the site need a redeploy (his step 6).
7. **Remotes** (5 min): `git remote set-url origin https://github.com/<organization>/holdback.git` in the main checkout (its worktrees share the setting). Tell the contributor to update the upstream of their fork. The cost clone is Rafa's (his step 6).

## Acceptance criteria

- [ ] The `gitleaks` job runs without `gitleaks-action` and passes, before the transfer (measured on the step-1 PR) and after it (measured on the step-4 PR).
- [ ] Both repositories are under the organization, and the web, raw and API URLs at the old path redirect, or the ones that do not are listed in Evidence (measured with `curl -sI`).
- [ ] Rafa confirms the organization settings in Handoff: 2FA required, no base permission, no repository creation by members, the token policy set, and the domain verified or noted as unavailable.
- [ ] The `holdback` `main` ruleset and security settings match the record from agent step 2 (measured with the API, diff in Evidence).
- [ ] The contributor has triage on `holdback` and write on the private repository (measured with `gh api repos/<organization>/<repository>/collaborators/<login>/permission`; Evidence records the result, not the login).
- [ ] `git grep 'rafaeldavid/holdback'` finds only the files left as written under Paths; `pnpm openapi`, `node site/build.mjs` and `node site/check.mjs` leave a clean tree; CI passes on the links PR; after Rafa's redeploy, the live `/llms.txt` names the organization's path (measured).

## Out of scope

- Incorporation and moving the organization to the company; GitHub Team (needed for protected branches, code owners and required reviewers on private repositories; a later choice for Rafa); the redeploys themselves (Rafa's gate).

## Evidence

## Decisions

## Handoff
