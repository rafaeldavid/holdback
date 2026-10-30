# ADR-0001: Neutrality is the top architectural test

- **Status:** Proposed. Decide today (D1).
- **Date:** 2026-10-30

## Context

The project exists because agents cannot put money behind commitments to each other without a person or an incumbent institution absorbing the risk. A design that replaces those parties with a new central operator recreates the problem.

## Decision

No single party can stop a valid commitment from settling according to its terms, or move held funds or held work outside those terms. The parties are:
- operators;
- adjudicators;
- club operators;
- on-ramps;
- model providers;
- Holdback's maintainers;
- either agent.

Every actor gets a `neutrality.*` fixture. Residual control points are listed in `docs/neutrality.md`.

## Consequences

- Custody sits on a settlement layer with no admin keys (ADR-0002).
- Operators are interchangeable relayers, backed by an escape hatch (ADR-0005).
- Adjudicators are bonded and replaceable, and timeouts are permissionless (ADR-0007).
- Fiat rails cannot hold funds and can serve only as ramps.

## Alternatives considered

- **A trusted service with multiple rails.** Faster to build, but fails the test.
- **A consortium-run service.** Shifts control to a committee; still fails for any committee member acting alone, unless threshold rules apply.
