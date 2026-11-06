# T-059: The founder console on its own host behind Access

- **Lane:** infra
- **Phase:** 11
- **Depends on:** nothing in this repository. Rafa moved the rest of the switch into Phase 11 on 2026-11-04 ("let's move this to security hardening phase"), after the code and two red-team rounds were done. He then went ahead with it the same day.
- **Paths this task may touch:**
  - the `control/` folder and its hourly workflow in the founders' private repository (the console's code, tests and runbook live there, never here);
  - here: `docs/operations.md` and `docs/costs.md` (once the passcode retires), `docs/decisions-today.md` (D45 notes only), `docs/tasks/T-059-control-access-switch.md`.
- **Human gate:** **yes.** The Access settings, the service tokens, the GitHub secrets, the storage namespace, the encryption key and every Worker deploy are outside this repository. Rafa does the dashboard steps himself; agents deploy only on his go-ahead, given in chat and recorded in Handoff with the date.
- **Status:** in progress (live at `control.escrow.stream` since 2026-11-04; criterion 5, the passcode's retirement, met on 2026-11-05; left: Michael's confirmation of Strategy, Costs and Keys (criterion 1), two scheduled builds without a failed run, which replaced the 24 hours of hourly runs under D52 (criterion 4), a red-team pass on the live console (criterion 6), and the agents' small items in Handoff)
- **Agent/session:** coordinator side session, 2026-11-04

## Intent

Move the founders' console from the passcode page at `escrow.stream/control` to its own host, `control.escrow.stream`, behind Cloudflare Access, as D45 decided: GitHub sign-in, one view for both founders, the private part encrypted at rest, an hourly public refresh and a daily private push. Then retire the shared passcode.

- Inputs: the console code in the founders' private repository, the Access application "Crow Control", Rafa's Cloudflare and GitHub accounts.
- Outputs: the console served at `control.escrow.stream` to signed-in founders only; the old address removed; the hourly and daily pushes running; the passcode retired.
- Non-goals: new console features; moving the console's code to a repository of its own (an open question for Rafa, below).

## Context

- **Why its own host.** On `escrow.stream`, the console shared an origin with the public site, so any script on any page there could read a signed-in founder's console (red-team finding M1). On its own host it can't.
- **What protects it** (the design, in the runbook kept with the code):
  - the page code is part of the Worker and runs by SHA-256 hash only, and pushers send data, never code;
  - pages open only as top-level navigations, and the holdback-generated pages (the design map and the contract stack) run sandboxed in an opaque origin;
  - the hourly build runs holdback code with no repository token and none of the private repository except the console's folder;
  - the push token never runs beside holdback code.
- **Rafa's choices on 2026-11-04.**
  - **One Access application:** `control.escrow.stream` joined the existing application, which keeps its audience tag.
  - **GitHub sign-in only, no Access MFA** ("let's just leave with Github sign in"). The second factor is each founder's GitHub two-factor or passkey; Access cannot see how GitHub verified the founder (red-team L11, accepted).
  - **The old address removed, not redirected** ("we can remove /control as we won't use it anymore"). He also declined forwarding `/control` on the new host as "a workaround".
- **Reviews.** Two red-team rounds ran on 2026-11-04. Their reports and attack scripts are kept outside this repository, with the console's code.

## Acceptance criteria

1. Both founders open `https://control.escrow.stream` through Access with GitHub as the only login method, and each sees Strategy, Costs and Keys (confirmed by Rafa).
2. Without a sign-in, `curl -sI https://control.escrow.stream` answers `302` to the sign-in; a push with a wrong or a reader's token answers `401` or `403` (measured).
3. `escrow.stream/control`, `/control/map` and `/control/contracts` serve nothing: they answer `404` (measured).
4. The hourly job has pushed for 24 hours without a failed run, and the Mac's daily private push has run once (measured). Since D52 (2026-11-05) the job builds twice a day, so this reads as two scheduled builds without a failed run.
5. The passcode is gone from Rafa's environment and from the key register; the passcode Worker's files are removed from the private repository (confirmed by Rafa and measured).
6. A red-team pass against the deployed console finds no High or Critical finding (measured).

## Evidence

All 2026-11-04.

**Before the switch**
- The console's code is in the founders' private repository, with 40 of 40 tests passing (measured, `node --test`, three test files) after the passcode removal. It covers the Access Worker, the three-job hourly workflow, the pushers and the key script.
- Red team, round 1: 1 High, 2 Medium and 12 Low findings. All are fixed or moved to Access settings in the runbook.
- Red team, recheck: 2 High and 4 Low new findings, all fixed in code or in the runbook. One of the High findings affected the live passcode console.
- Rafa rebuilt the passcode console; its check passed (measured). It was redeployed as `crow-control` version `5fc7e314`, serving the console alone and keeping no key in the browser.
- That console then showed "No data" after the passcode (reported by Rafa).
  - **Cause.** Since the red-team fix, the console's data sits in `<script type="application/json">` blocks. The passcode page re-created every script and copied only its text, so the blocks lost their type and id and ran as code (reproduced in Chromium headless shell: 0 data blocks, 2 syntax errors).
  - **Fix.** The page now re-creates code scripts only, with their attributes. In Chromium the data loads, 3 data blocks stay intact, and the header, Strategy and 37 strips render (measured).
  - **Live.** Rafa rebuilt, checked and redeployed as `crow-control` version `bf004e77`. He confirmed: "ok, https://escrow.stream/control is showing the data" (measured by Rafa).

**The switch**
- **Setup (Rafa):** the Access settings, the two service tokens (`control-push-actions`, `control-push-mac`), the "Pushers" Service Auth policy, the GitHub secrets, `CONTROL_HOURLY` = `on`, and the encryption key (`new-kek.mjs`).
- **Setup (agents):** created the KV namespace and filled in the push scopes.
- **Deploy:** `crow-console` version `2398336c`, at 15:44 UTC. The deploy created the DNS record for `control.escrow.stream` with no extra permission. Without a sign-in, `/`, `/map` and `/_push/public.json` answer `302` to the sign-in, and a push with a wrong service token answers `401` (measured).
- **First pushes.** A push first got `403` from Access because the Pushers policy was not yet attached to the application; once it was, the token passed (measured with a diagnostic).
  - **The Mac's private part:** `HTTP 204` (11 keys and the costs, 9 KB sealed).
  - **The hourly job's re-run** (run 41865777731) pushed the public data (465 KB), status (157 bytes), map (202 KB) and contract stack (55 KB), each with `204` (measured).
  - **GitHub's Actions incident** that afternoon left runs queued and their records inconsistent.
- **Current data.** The stored public data was pushed at 16:28 UTC from holdback `dd0a55a`, which was main at that time (measured).
- **Sign-in.** A sign-in that ended on `/control` came from the old `escrow.stream/control` destination. Rafa removed it from the application, and `/` now opens the console.
- **The old console removed.** The `crow-control` Worker is deleted (measured). `escrow.stream/control`, `/control/` and `/control/map` answer `404`, and no encrypted page is served (measured). The passcode console's files and the never-deployed redirect Worker are removed from the private repository, and a regression test keeps them removed.

**2026-11-05**
- **Criterion 5 met, confirmed by Rafa ("done").** Rafa ran four commands the coordinator gave him:
  1. deleted `CROW_CONTROL_PASSCODE` from holdback `.env`;
  2. checked it was gone with `grep -c`, which prints a count only;
  3. backed up `keys.json` in the cost directory, then replaced it with `control/keys.template.json`;
  4. ran the private push.
- **Hourly runs (criterion 4), not yet met.** GitHub's scheduler skipped most scheduled runs: between 2026-11-04 21:25 UTC and 2026-11-05 15:30 UTC the job ran on schedule 3 times, at 23:42, 06:51 and 15:30 UTC, and all passed (measured, `gh run list --repo rafaeldavid/crow-private --workflow control-hourly.yml`). A separate PR makes the console refresh on every merge to main. That PR, holdback#214, closed unmerged: D52 replaced the hourly schedule with two builds a day at 07:07 and 16:07 Berlin time.

## Handoff

The console is live; the runbook in the console's folder describes how it runs. Left:

1. **Rafa:**
   - ~~delete `CROW_CONTROL_PASSCODE` from holdback `.env`~~ (done 2026-11-05, Evidence);
   - ~~update `keys.json` in the cost directory from the template (the passcode row is gone; the two service tokens, the encryption key and `GH_READ` are in, expiring about 2027-02-02)~~ (done 2026-11-05, Evidence);
   - add the daily private push to the cost routine (T-055);
   - confirm that both founders see Strategy, Costs and Keys (criterion 1): Michael's confirmation is still open.
2. **Agents:**
   - after two scheduled builds under D52, check the runs and the private push (criterion 4); "Run workflow" on `control-hourly` covers a run GitHub's scheduler skips;
   - run a red-team pass against the live console (criterion 6), best once T-066's remaining slices land (paused under D53);
   - with the next Worker deploy, change the page's "No data" message, which still names the removed `build.mjs`;
   - update `docs/operations.md` and `docs/costs.md` if they describe the console.

Open questions for Rafa:
- Should the strategy questions move into the encrypted private part?
- Should the console's code move to a private repository of its own?
