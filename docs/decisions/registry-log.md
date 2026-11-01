# Judge registry log

One entry per change to `config/judges.yaml`: candidate added, promotion, retirement. Each entry gives the date, judge ID, provider and family, pinned model ID, calibration report link, metrics (false-accept rate, false-reject rate, red-team auto-accepts, n), the decision and the approver.

Entries are added from T-009 onward. Promotions follow the rule in `docs/judgment-and-defenses.md` (Model registry).

## 2026-11-01: first live registry, `config/judges-live.yaml` v1 (T-028)

- **Decision:** a second registry file holds the first real pinned models; `config/judges.yaml` (placeholders, hash `0x8aa41fa9…`) is unchanged and stays the scripted registry for `pnpm demo`, `pnpm sim`, the fixtures and snapshots. A panel is a seeded shuffle of every active entry, so one registry mixing placeholders with real models would seat judges a live adjudicator cannot call. Live adjudicators (`pnpm demo --live`, the public demo when its keys are set) publish this registry instead; a commitment binds whichever registry its primary publishes.
- **Hash:** `0xbf318eb4d10af866a13289904c5b136439e80e389d29638e27b360645c46b6ac` (keccak256 of RFC 8785 JSON).
- **Approver:** Rafa (keys added and live judging requested, 2026-11-01). **Not calibrated:** no calibration report, no metrics; this is a demo promotion at test scale, not the promotion rule. Calibration before any non-demo use (backlog).

| Judge ID | Provider | Family | Pinned model ID | Sent to the provider as | Status |
|---|---|---|---|---|---|
| claude-sonnet-5-5 | anthropic | claude | `claude-sonnet-5-5@2026-09-28` | `claude-sonnet-5-5` | active |
| claude-haiku-5-5 | anthropic | claude | `claude-haiku-5-5@2026-10-07` | `claude-haiku-5-5` | active |
| claude-sonnet-5 | anthropic | claude | `claude-sonnet-5@2026-06-29` | `claude-sonnet-5` | active |
| deepseek-v4-pro | openai-compatible (api.deepseek.com) | deepseek | `deepseek-v4-pro@2026-11-01` | `deepseek-v4-pro` | active |
| deepseek-flash | openai-compatible (api.deepseek.com) | deepseek | `deepseek-flash@2026-11-01` | `deepseek-flash` | active |

- **ID form:** the registry loader requires a date or revision stamp, and these provider IDs carry none, so each ends in `@<date>` (Vertex AI's convention); the live provider strips it. Anthropic: the three IDs are Anthropic's snapshot IDs (no dated form exists for them); the date is each model's `created_at` from `GET /v1/models`, checked 2026-11-01. DeepSeek: `GET /models` on 2026-11-01 listed only `deepseek-flash` and `deepseek-v4-pro`. **Limit:** these are provider aliases; DeepSeek can change the model behind a name without a new ID, so the `@2026-11-01` date records when they were checked, not a snapshot. Drift is detectable only by re-running calibration (threat T7).
- **Why five:** the default policy's appeal panel is five judges; with two families the appeal family minimum is capped at two (the service already caps it at the families the registry has).
- **Request settings** (apps/adjudicator/src/providers/live.ts): output cap 2,048 tokens per call; Anthropic with `output_config.effort: "low"` and no sampling parameters (current Claude models reject a non-default temperature); DeepSeek with temperature 0. Neither gets tools or URLs.
