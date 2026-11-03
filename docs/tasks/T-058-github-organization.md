# T-058: Move the repositories into a GitHub organization

- **Lane:** infra
- **Phase:** 9
- **Depends on:** nothing in the repository. It starts after a working mainnet prototype (Rafa, 2026-11-03: "lets add this to the roadmap for later, once we have working mainnet prototype"). Mainnet itself is Rafa's gate after the external audit (D4).
- **Paths this task may touch:** links only, in `README.md`, `CONTRIBUTING.md`, `site/` (`build.mjs`, `check.mjs`, `llms.txt`, and the generated `index.html` and `try.mjs`), `examples/try.ts`, `spec/openapi/paths.json` and the generated `spec/openapi.json`, `tools/design-map/template.html`, `docs/` (living documents; logs, reviews and task Evidence stay as written); `.github/CODEOWNERS`; `docs/operations.md` (where the repositories live); `docs/tasks/T-058-github-organization.md`
- **Human gate:** **yes.** Creating the organization, its settings, the DNS record, transferring repositories and granting access are all outside the repository. Rafa does the organization steps himself; agents run the transfer and access steps only on his go-ahead, recorded in Handoff with the date.
- **Status:** todo
- **Agent/session:** —

## Intent

Move `rafaeldavid/holdback` and the private companion repository `rafaeldavid/crow-private` into a GitHub organization that Crow owns, with least-privilege defaults, so contributors can get roles narrower than write, and so the company can own the code at incorporation.

- Inputs: the two repositories, Rafa's account, the `escrow.stream` DNS zone on Cloudflare.
- Outputs: an organization with 2FA required and no default access; both repositories transferred with their protections and security settings intact; teams with the right roles; links and remotes updated.
- Non-goals: incorporation, moving the organization to the company (Rafa's step at incorporation), a paid GitHub plan, anything about the Cloudflare account.

## Context

- **When.** Rafa set the trigger: after a working mainnet prototype. Until then, outside contributors work from a fork under `CONTRIBUTING.md` (PR 151).
- **Why an organization.** On a personal account, a collaborator can only get write: GitHub refused the triage role on `holdback` (measured by the coordinating session, 2026-11-03). Organization repositories offer triage, "for contributors who need to proactively manage issues … without write access" (documented, GitHub's repository roles page, read 2026-11-03).
- **What a transfer keeps** (documented, GitHub's "Transferring a repository", read 2026-11-03): issues, pull requests, wiki, stars and watchers; webhooks, secrets and deploy keys; commit history. Web links and git remotes redirect to the new location. Creating a repository or fork at the old location deletes the redirects permanently. The page does not say whether repository rulesets, security settings or GitHub App installations move, so this task checks each one after the move.
- **Plan limits.** A private repository transferred to a GitHub Free organization loses protected branches (documented). Protected branches, code owners and required reviewers in private repositories need GitHub Team (documented, GitHub's plans page). Today `crow-private` has none of them anyway: on Rafa's personal Free plan the API answers "Upgrade to GitHub Pro" for its rulesets and branch protection (measured, 2026-11-03), so nothing is lost. `holdback` is public, and its `main` ruleset is active on the Free plan today (measured).
- **Today's protections on `holdback`** (measured, 2026-11-03): the `main` ruleset (PR required; `check` and `gitleaks` must pass; no force push; no bypass), secret scanning with push protection, Dependabot security updates, CodeQL default setup.
- **Links:** 52 references to `github.com/rafaeldavid/holdback` in tracked files (measured, 2026-11-03), 17 of them in each OpenAPI file. The redirects keep them working, so updating them is tidiness, not a fix.

## Rafa's steps

Every step is **human**. About 45 minutes, plus up to 72 hours for DNS (guessed; the 72 hours is GitHub's documented upper bound).

1. **Create the organization** (10 min) on the free plan, from https://github.com/organizations/plan.
   - Name: neutral and close to the domain, for example `escrowstream` (no GitHub account used that name on 2026-11-03, measured). It can be renamed later, which matters while the trademark question on "Crow" is open.
   - Contact email: a team address, not a personal one.
   - Owner: "My personal account" for now; switch it to the company at incorporation.
2. **Settings** (15 min), under the organization's Settings:
   - Authentication security: "Require two-factor authentication for everyone in your organization" (documented). Members without 2FA lose access until they turn it on; outside collaborators without it are removed (documented). Your own 2FA must already be on.
   - Member privileges, Base permissions: no permission, so access comes only from teams (documented path).
   - Member privileges, repository creation: members cannot create public repositories (inferred path; GitHub's page on restricting repository creation was not read).
   - Third-party application access: check whether the GitHub CLI and Claude need approval to act on the organization's repositories, and approve them if so (inferred: a policy may restrict OAuth apps on new organizations).
   - Verified and approved domains: add `escrow.stream`, then add the TXT record GitHub shows in Cloudflare's DNS for the zone. GitHub's page does not say whether Free organizations get this; if the option is missing, note it in Handoff and skip it.
3. **The Claude GitHub App** (5 min). Install it on the organization for the two repositories (Settings, GitHub Apps), with the same repository selection as today (inferred: app installations belong to an account, so the personal installation does not cover the organization).
4. **Go-ahead** (1 min). Write in Handoff, with the date, that agents may run the transfer and access steps.
5. **After the agents' steps** (10 min). Check the organization's audit log for anything you did not expect, and confirm the outside contributor can triage on `holdback`.

## Agent steps

Run these only after Rafa's step 4. Agents act through Rafa's `gh` login, so every call below is his account acting on his instruction.

1. **Record what exists** (15 min), in `reports/scratch/t-058-before.json`: the `holdback` rulesets with their rules (`gh api repos/rafaeldavid/holdback/rulesets` and each ruleset by ID), `security_and_analysis`, Actions secret and variable names (never values), webhooks and deploy keys (IDs and URLs only), environments. The same for `crow-private`, where they exist.
2. **Transfer** (10 min). `gh api -X POST repos/rafaeldavid/holdback/transfer -f new_owner=<organization>`, then the same for `crow-private`. Never create a repository named `holdback` or `crow-private` under `rafaeldavid` afterwards: it would delete the redirects.
3. **Check what moved** (20 min), against the record from step 1: the `main` ruleset active with the same rules, and recreated from the record if missing; secret scanning, push protection, Dependabot security updates and CodeQL default setup on; the secret and variable names present; webhooks and deploy keys present. Record each result in Evidence.
4. **Teams and roles** (10 min). Create `maintainers` (Rafa; admin on both repositories) and `contributors`. Give the first outside contributor, named by Rafa in the go-ahead, triage on `holdback` and write on `crow-private`, through `contributors` if team roles allow triage, otherwise directly. They need 2FA on before joining.
5. **Links** (1 hour), in a PR: replace `github.com/rafaeldavid/holdback` with the organization's path in the living documents and code listed under Paths. Regenerate `spec/openapi.json` (`pnpm openapi`) rather than editing it; the change is to links in descriptions, not the contract. Rebuild the site (`node site/build.mjs`, then `node site/check.mjs`); `site/try.mjs` and its sha256 in `llms.txt` change with `examples/try.ts`, so the site needs a redeploy, which is Rafa's (`docs/operations.md`, Deploy). Consider `@<organization>/maintainers` in `.github/CODEOWNERS`.
6. **Remotes** (10 min): `git remote set-url origin https://github.com/<organization>/holdback.git` in the main checkout (its worktrees share the setting), in the T-052 cost clone if it exists, and in any clone of `crow-private`. Tell the outside contributor to update the upstream of their fork.
7. **Confirm nothing else broke** (10 min): CI runs and passes on the links PR; the Cloudflare deploys need nothing, since they run from a local checkout with wrangler and no workflow deploys (measured: `.github/workflows/ci.yml` has no deploy job).

## Acceptance criteria

- [ ] Both repositories are under the organization, and `https://github.com/rafaeldavid/holdback` redirects to the new location (measured with `curl -sI`).
- [ ] Rafa confirms the organization settings in Handoff: 2FA required, no base permission, no public repository creation by members, and the domain verified or noted as unavailable.
- [ ] The `holdback` `main` ruleset and security settings match the record from agent step 1 (measured with the API, diff in Evidence).
- [ ] The outside contributor has triage on `holdback` and write on `crow-private` (measured: `gh api repos/<organization>/holdback/collaborators/<login>/permission`).
- [ ] `git grep 'rafaeldavid/holdback'` finds only historical records (logs, reviews, task Evidence); `pnpm openapi`, `node site/build.mjs` and `node site/check.mjs` leave a clean tree; CI passes on the links PR (measured).

## Out of scope

- Incorporation and moving the organization to the company; GitHub Team (needed for protected branches, code owners and required reviewers on private repositories; a later choice for Rafa); redeploying the site (Rafa's gate).

## Evidence

## Decisions

## Handoff
