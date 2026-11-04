# T-059: The founder console on its own host behind Access

- **Lane:** infra
- **Phase:** 11
- **Depends on:** nothing in this repository. Rafa moved the rest of the switch into Phase 11 on 2026-11-04 ("let's move this to security hardening phase"), after the code and two red-team rounds were done.
- **Paths this task may touch:**
  - the `control/` folder and its hourly workflow in the founders' private repository (the console's code, tests and runbook live there, never here);
  - here: `docs/operations.md` and `docs/costs.md` (once the passcode retires), `docs/decisions-today.md` (D45 notes only), `docs/tasks/T-059-control-access-switch.md`.
- **Human gate:** **yes.** The Access settings, the service tokens, the GitHub secrets, the storage namespace, the encryption key and every Worker deploy are outside this repository. Rafa does the dashboard steps himself; agents deploy only on his go-ahead, given in chat and recorded in Handoff with the date.
- **Status:** todo (the code is done; Rafa's setup steps and the deploys wait for Phase 11)
- **Agent/session:** —

## Intent

Move the founders' console from the passcode page at `escrow.stream/control` to its own host, `control.escrow.stream`, behind Cloudflare Access, as D45 decided: GitHub sign-in with passkeys, one view for both founders, the private part encrypted at rest, an hourly public refresh and a daily private push. Then retire the shared passcode.

- Inputs: the console code in the founders' private repository, the Access application "Crow Control", Rafa's Cloudflare and GitHub accounts.
- Outputs: the console served at `control.escrow.stream` to signed-in founders only; the old address redirecting there; the hourly and daily pushes running; the passcode retired.
- Non-goals: new console features; moving the console's code to a repository of its own (an open question for Rafa, below).

## Context

- **Why its own host.** On `escrow.stream`, the console shares an origin with the public site, so any script on any page there could read a signed-in founder's console (red-team finding M1). On its own host it doesn't.
- **What protects it** (the design, in the runbook kept with the code):
  - the page code is part of the Worker and runs by SHA-256 hash only, and pushers send data, never code;
  - pages open only as top-level navigations, and the holdback-generated pages (the design map and the contract stack) run sandboxed in an opaque origin;
  - the hourly build runs holdback code with no repository token and none of the private repository except the console's folder;
  - the push token never runs beside holdback code.
- **One Access application for both hosts**, by Rafa's choice (2026-11-04). Until the old `escrow.stream/control` destinations leave the application, a session cookie taken from `escrow.stream` would also open the new host. Only server code on `escrow.stream` can read it, and all of that code is the founders'.
- **Reviews.** Two red-team rounds ran on 2026-11-04. Their reports and attack scripts are kept outside this repository, with the console's code.

## Acceptance criteria

1. Both founders open `https://control.escrow.stream` through Access with GitHub as the only login method and Independent MFA required, and each sees Strategy, Costs and Keys (confirmed by Rafa).
2. Without a sign-in, `curl -sI https://control.escrow.stream` answers `302` to the sign-in; a push with a wrong or a reader's token answers `401` or `403` (measured).
3. `escrow.stream/control`, `/control/map` and `/control/contracts` answer `301` to the same page on the new host (measured).
4. The hourly job has pushed for 24 hours without a failed run, and the Mac's daily private push has run once (measured).
5. The passcode is gone from Rafa's environment and from the key register; the passcode Worker's files are removed from the private repository (confirmed by Rafa and measured).
6. A red-team pass against the deployed console finds no High or Critical finding (measured).

## Evidence

All 2026-11-04.

- Access fronts `escrow.stream/control` and `/control/*`: each answers `302` to the team's sign-in (measured).
- The console's code is in the founders' private repository, with 41 of 41 tests passing (measured, `node --test`, three test files). It covers the Access Worker, the redirect Worker, the three-job hourly workflow, the pushers and the key script.
- Red team, round 1: 1 High, 2 Medium and 12 Low findings. All are fixed or moved to Access settings in the runbook.
- Red team, recheck: 2 High and 4 Low new findings, all fixed in code or in the runbook. One of the High findings affected the live passcode console.
- Rafa rebuilt the passcode console; its check passed (measured). It was redeployed as `crow-control` version `5fc7e314`, serving the console alone and keeping no key in the browser.
- Rafa added `control.escrow.stream` to the Crow Control Access application.
- `control.escrow.stream` does not resolve yet (NXDOMAIN, measured): the console Worker's first deploy creates the record.

## Handoff

Resume from the runbook in the console's folder ("Rafa's steps"; step 0 is done):

1. **Rafa:**
   - check the application's settings (GitHub only, required Independent MFA, a 24 h session, HTTP-only cookie, the binding cookie, a 401 for refused service tokens);
   - create the two service tokens and their "Pushers" policy;
   - set the GitHub secrets and create the KV namespace;
   - send the agents the two Client IDs and the namespace ID.
2. **Agents:** fill them into the Worker's configuration, rerun the tests and commit.
3. **Rafa, with agents on his go-ahead:** deploy the console, set the key, turn on the hourly job, push the private part and check both sign-ins. Then deploy the redirect and remove the old destinations from the application.
4. **Rafa:** add the daily push to the cost routine and retire the passcode.
5. **Agents:** remove the passcode gate's files, update `docs/operations.md` and `docs/costs.md`, and run a red-team pass on the deployed console.

Open questions for Rafa:
- Should the strategy questions move into the encrypted private part?
- Should the console's code move to a private repository of its own?
