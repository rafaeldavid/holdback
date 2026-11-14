# T-406: the seller adapter prices a quote that counts units at a fixed price per unit

- **Lane:** demo (examples), the seller adapter
- **Phase:** 2, settlement on EVM (stable EVM operations, D53)
- **Kind:** 4 (API and example code), from the Change recipes in `docs/team.md`: the examples' tests, one reviewer
- **Depends on:** T-366 (the adapter calls a seller's job API through a mapping); found by T-399 (the pilot rehearsal on the live deployment)
- **Paths this task may touch:** `examples/seller-adapter-api.ts`, `examples/seller-adapter-job-api.test.ts`, `site/ref/seller-adapter.txt`, this file. Never: settlement, judgment, auth or the operators.
- **Human gate:** no. Rafa set the rule on 2026-11-14: the seller's API returns a quote in credits, and the adapter converts it at a fixed price per credit. Nothing deploys; the guide reaches crow.direct with the next site deploy, which is Rafa's.
- **Status:** review (this pull request)
- **Agent/session:** the T-399 session, 2026-11-14, branch `t-406-quote-unit-price`

## Intent

A seller adapter turns a quote from the seller's own API into a signed offer, and it can only copy a price from the answer, in the token's base units. Some sellers price in their own units. The pilot's seller answers a quote with a count of credits (`quoted_price`, a whole number), not with an amount of test tokens, so the adapter refused every quote and no offer could be made. This task lets a configuration say: read a count at this pointer, and price each unit at this many base units. The price is that product, in base units, with no float.

## Acceptance criteria

- [x] `sellerApi.quote.read.units` (a pointer) with `sellerApi.quote.unitPrice` (base units as a decimal string) prices a quote as count times unit price.
- [x] The count may be a whole number or digits as text; anything else (a fraction, a negative, nothing) refuses the quote, naming the pointer.
- [x] A configuration with one of the two and not the other, with both `units` and `amount`, or with a unit price that is not base units, is refused at start, naming the field.
- [x] The adapter's start-up line says how it prices; configurations without `units` behave as before.
- [x] `site/ref/seller-adapter.txt` says how to use it; the site build and check pass.

## Evidence

Measured on 2026-11-14 in the worktree `.worktrees/t-405-unit-price`, cut from `origin/main` at `71e7fbb`.

- **Test first.** The new test in `examples/seller-adapter-job-api.test.ts` failed before the change: `sellerApi.quote has a field the adapter does not take: unitPrice`.
- **After.** With `read.units` `/quoted_price` and `unitPrice` `"1500000"`: an answer of `500` gives `750000000` (750.00 tUSDC); `"7"` gives `10500000`; `1.5`, `-3` and a missing count are refused with "the quote's /quoted_price is not a whole number of units". The four configuration refusals fire as written. The start-up line adds "a quote prices /quoted_price units at 1500000 base units each".
- **Tests.** `vitest run examples/seller-adapter-job-api.test.ts examples/seller-adapter.test.ts`: 2 files, 64 tests passed.
- **Site.** `node site/build.mjs` rewrote no bundle (`buy.mjs` and `try.mjs` unchanged); `node site/check.mjs` passed.

## Handoff

**Done.** The option, its refusals, its test and its guide line. The guide line reaches crow.direct with the next site deploy (Rafa's word); the adapter runs from the repository, so no deploy is needed to use it.

**Use (pilot):** in the seller's configuration, `"quote": {…, "read": {"units": "/quoted_price"}, "unitPrice": "1500000"}`: 1.50 tUSDC a credit, so a 500-credit quote is offered at 750.00 tUSDC.
