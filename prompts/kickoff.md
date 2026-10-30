You're starting a new repository for Holdback: a prototype of machine-speed escrow between agents, driven by direct API calls, with defended multi-model judgment, on a settlement layer that no single party controls.

1. Read `CLAUDE.md`, then:
   - `docs/decisions-today.md`
   - `docs/PRD.md`
   - `docs/neutrality.md`
   - `docs/architecture.md`
   - `docs/judgment-and-defenses.md`
   - `docs/demo.md`
   - `docs/testing.md`
   - `docs/team.md`
   - `docs/plan.md`

   Skim `docs/research/README.md`. Open research files only when a decision needs them.
2. In your reply, restate the objective, the three litmus tests and the Phase 0 and Phase 1 exit criteria in your own words. List any contradictions or gaps you find in the docs.
3. List which of decisions D1–D9 block Phase 0 and Phase 1, with my recommended option for each. Wait for my confirmation before treating any Proposed ADR as accepted.
4. Ask before creating the GitHub repository. If I approve, run:
   `git init && git add -A && git commit -m "Holdback starter kit v0.1" && gh repo create rafaeldavid/holdback --private --source . --remote origin --push`
5. Then run Phase 0 as a team:
   - T-001 yourself, as implementer.
   - T-002 and T-003 in parallel through subagents using the research procedure in their task files.
   - T-011 after T-001.

   Use worktrees and branches per `docs/team.md`. Each task ends with Evidence and Handoff filled in, and a PR.
6. Stop at the end of Phase 0 and report:
   - what works, with evidence labeled measured, inferred or guessed;
   - the T-002 recommendation on the escrow base (D3);
   - the T-003 recommendation on compute-native agreements (D9);
   - proposed edits to the Phase 1 task files.

Constraints:
- no real money and no live keys;
- no code execution from inputs;
- deliverables are untrusted;
- no admin keys in any settlement code;
- human gates per `docs/team.md`.
