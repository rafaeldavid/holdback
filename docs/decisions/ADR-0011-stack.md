# ADR-0011: Stack

- **Status:** Accepted, 2026-10-30.
- **Date:** 2026-10-30

## Decision

| Area | Choice |
| --- | --- |
| Monorepo | TypeScript (strict, ESM), Node 22 LTS, pnpm workspaces |
| API | Fastify |
| Storage | SQLite via better-sqlite3 for the operator index and the SimChain store; Postgres later |
| Validation | Ajv (draft 2020-12) against `spec/schemas` |
| EVM | viem for EIP-712, signing and the contract client |
| Tests | Vitest, fast-check |
| Contracts | Foundry (Solidity) from Phase 2 |
| Judge providers | Anthropic SDK; an OpenAI-compatible client for a second family; recorded and fake providers |
| MCP wrapper | MCP TypeScript SDK, stable v1 line (`@modelcontextprotocol/sdk`). v2 was alpha in October 2026 and adds opt-in support for the 2026-07-28 spec revision |
| Demo agents | Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`), optional, Phase 6 |
| Formal model | TLA+ or Quint |

Versions are resolved at install time, not pinned from memory.

## Consequences

One language covers the operator, adjudicator, SDK, testkit and demo. Contracts sit in a separate Foundry tree.
