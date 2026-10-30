# Engineering practice sources for the agent-team setup

These are the sources behind `docs/team.md`, `docs/testing.md`, ADR-0009 and ADR-0010. Gathered October 30, 2026. The X posts themselves could not be fetched; claims are taken from secondary summaries and labeled as such.

## Ron Minsky (Jane Street), "Now more than ever: building reliable software in the age of agents"

Bug Bash 2026, premiered May 14, 2026. https://www.youtube.com/watch?v=rUYP4C29yCw

The practices recommended, per the video description:
- type systems for fast feedback and invariants agents can follow;
- making illegal states unrepresentable;
- expect tests;
- deterministic simulation at the library level;
- example-based testing;
- code review as a core practice;
- growing use of formal verification, since agents make it more affordable.

Applied here as:
- discriminated-union state types;
- scenario expect tests over SimChain;
- table-driven examples;
- a formal model of the state machine (Phase 2);
- review gates.

## Lauren Tan (@poteto): pstack and posts

Secondary sources:
- "pstack skills guide," Redreamality garden notes. https://redreamality.com/garden/notes/pstack-skills-guide/
- "Lauren Tan AI workflows" (editorial summary of linked X posts). https://github.com/Latencius/lauren-tan-ai-workflows
- Poteto Mode listing. https://mcpmarket.com/tools/skills/poteto-mode

Practices attributed (secondary; original posts not retrieved):
- Run parallel agents only after you can trust one agent's verifiable output.
- Make results observable: give the agent a way to run the product and collect evidence. Maintain verification tools as the app changes. Keep a feature map per user-facing feature.
- Label claims as measured, inferred or guessed.
- Use adversarial review across model families (`interrogate`), and compare designs with N agents plus a judge (`arena`). For coverage, split work into independent slices whose workers report PASS, ISSUES or BLOCKED (`swarm`).
- Fix repeated problems in architecture, types, lint or tests, and keep a table pairing each rule with the check that enforces it (`correct`).
- Ship from worktrees, with small ordered commits. Irreversible actions wait for human approval.
- Restate the goal before implementing when ambiguity is consequential.
- Use TLA+ models for workflow verification (the source reports bugs found).

Applied here as:
- the Rules and checks table;
- PASS/ISSUES/BLOCKED review outputs;
- the claim labels;
- role subagents;
- worktree-per-task;
- verification before parallel lanes;
- the architect's design comparisons;
- cross-family review for settlement and judgment code.

## React Compiler fixture suite

The fixtures directory at `react/react` (`compiler/packages/babel-plugin-react-compiler/src/__tests__/fixtures/compiler`) could not be fetched (robots). The format follows the commonly documented conventions of that suite:
- one input file per fixture with a generated `.expect.md` snapshot;
- an `error.` filename prefix for cases expected to fail;
- a `todo.` prefix for known gaps;
- configuration pragmas in a first-line comment;
- a runner with an update mode.

Only the format is adopted. Most compiler-specific cases have no counterpart here.

Contributing guide (secondary): https://www.mintlify.com/facebook/react/compiler/contributing
