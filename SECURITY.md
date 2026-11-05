# Security policy

## Report a vulnerability

Report privately through GitHub: open the **Security** tab of this repository and choose **Report a vulnerability**. Do not open a public issue or pull request for a suspected vulnerability.

Include the affected component and commit, the steps to reproduce (a proof of concept if you have one), and the impact you expect.

## What happens next

- We acknowledge your report within 3 business days.
- We assess severity and confirm or decline the issue within 7 days.
- We fix in private, keep you updated, and publish a GitHub security advisory once the fix ships, crediting you unless you prefer otherwise.
- We aim to disclose within 90 days of your report, sooner if the fix ships sooner.

## Scope

In scope:

- the settlement contracts in `contracts/src/` and their testnet deployments listed in `contracts/deployments/`;
- the operator API (`apps/operator`, `apps/demo-cloud`), served at api.escrow.stream and api2.escrow.stream;
- the judgment pipeline (`packages/judgment`), including prompt-injection defenses;
- the site at escrow.stream and the `try.mjs` script it serves;
- Crow's test seller (`apps/test-agents`), served at escrow.stream/agents/test-seller.

Out of scope:

- contracts reused unchanged (Coinbase Commerce Payments `AuthCaptureEscrow` and its collectors, Permit2, Multicall3): report those to their maintainers;
- controls a token issuer holds over its own token;
- denial of service by request volume, spam and social engineering;
- issues that need an already compromised device or account;
- the value of test tokens, which have none.

## Safe harbor

We treat security research that follows this policy as authorized. We will not pursue legal action against you for it, provided you act in good faith, avoid privacy violations and service disruption, use only test tokens and your own accounts, and go no further than needed to show the issue.

## Status

Crow runs on testnets (Sepolia) and a simulated chain, with test tokens only. There is no bug bounty yet. A bounty sized to the funds at risk starts before any mainnet deployment, after independent audits.

## Supported versions

Only the `main` branch and the contracts currently listed in `contracts/deployments/` receive fixes.
