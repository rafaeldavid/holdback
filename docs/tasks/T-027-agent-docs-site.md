# T-027: The site at npc.here.now/escrow: tagline and agent docs

- **Lane:** demo + docs
- **Phase:** 1 (public demo)
- **Depends on:** T-025 (docs content); T-026 (live URLs, filled in at the end)
- **Paths this task may touch:** `site/` (new: `index.html`, `llms.txt`, `agents.md` or equivalent), `docs/tasks/T-027-agent-docs-site.md`
- **Human gate:** publishing is done by the coordinator (Rafa approved the location on 2026-11-01)
- **Status:** todo
- **Agent/session:** —

## Intent

Rafa, 2026-11-01: "keep it super super simple (apple light simple), only a tagline and agent docs needed for someone to execute the protocol." The page is for a person deciding to try it and, mostly, for the agent they point at it. An agent reading only this site (no repo) can run one honest checks-only deal: get keys, get test tUSD, offer, agree and fund, deliver, settle.

Restate this in your own words in this section before writing code.

## Design

- Static files only (here.now hosting). One `index.html`: a one-line tagline, one sentence on what it is, a "Point your agent here" line with the `llms.txt` URL, the test-token notice, and the agent docs below or behind one link. Light, generous white space, one typeface, no illustrations, no marketing sections. Works at phone width. Mirror the docs as `llms.txt` (plain text, the canonical agent entry).
- Every relative URL must work under the path prefix `/escrow/`.
- API base URLs are placeholders `{{OP1}}` and `{{OP2}}` that the coordinator fills after T-026 deploys; keep them in one place.

## Agent docs content (from `docs/api.md` and `docs/quickstart.md`, rewritten for an outsider with no repo)

- What it does in three lines: buyer funds a hold, seller delivers encrypted work, checks decide, money and the key move together.
- Keys: generate a secp256k1 signing key and an x25519 encryption key with any standard library (name viem/ethers/eth-account and tweetnacl/libsodium/PyNaCl).
- The happy path as numbered calls with request and response shapes: discovery, faucet, recipients, `prepare/offer` → sign → submit, `prepare/agree-and-fund` → verify → sign → submit, ciphertext upload, envelope spec (AES-256-GCM + x25519-xsalsa20poly1305 box, with the test vector), `prepare/delivery` → sign → submit, poll state, read the key, open and check hashes.
- Verify before you sign: the short checklist (pin the domain, your own nonces, expected price, terms key is yours, time from two operators). The EIP-712 domain and types inline so no repo is needed.
- Writing checks that protect a buyer (the T-025 worked example, checks-only template).
- Honest limits: test tUSD only, a simulated settlement layer shared by both nodes, one basic adjudicator with real deterministic checks and a scripted panel, state may reset, edge cases not covered. Link the public repo for the curious, not as a requirement.

## Acceptance criteria

- [ ] `site/index.html` and `site/llms.txt` exist, match the design, and contain everything above; no repo link is required to complete the happy path.
- [ ] A check (test or script) confirms every `{{OP1}}`/`{{OP2}}` placeholder is in a known place and every relative link resolves under `/escrow/`.
- [ ] Content agrees with `docs/api.md` (field names, routes, envelope spec, test vector).
- [ ] PR opened.

## Out of scope

- Hosting and publishing (coordinator); brand work beyond the tagline; anything beyond the happy path.

## Evidence

## Decisions

## Handoff
